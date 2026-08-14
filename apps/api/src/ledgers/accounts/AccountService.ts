import { Context, Effect, Layer, Option } from "effect";
import { TypeID } from "typeid-js";
import { BadRequestError, ServiceUnavailableError } from "@/lib/errors";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { type LedgerGetError, LedgerServiceTag, type LedgerService } from "../LedgerService";
import { Account } from "./domain/Account";
import {
	type AccountInfrastructureError,
	AccountNotFound,
	AccountRepositoryUnavailable,
} from "./AccountErrors";
import {
	type AccountCreateRepositoryError,
	type AccountDeleteRepositoryError,
	type AccountListQuery,
	type AccountRepo,
	AccountRepoTag,
	type AccountUpdateRepositoryError,
} from "./AccountRepo";
import type { AccountCreateRequest, AccountUpdateRequest } from "./AccountSchema";

type AccountListError = AccountInfrastructureError | LedgerGetError;
type AccountGetError = AccountNotFound | AccountInfrastructureError;
type AccountCreateError =
	| BadRequestError
	| Exclude<AccountCreateRepositoryError, AccountRepositoryUnavailable>
	| LedgerGetError
	| ServiceUnavailableError;
type AccountUpdateError = AccountNotFound | AccountUpdateRepositoryError;
type AccountDeleteError = AccountNotFound | AccountDeleteRepositoryError;

const requireFound = (
	organizationId: OrgID,
	ledgerId: LedgerID,
	accountId: LedgerAccountID
): ((account: Option.Option<Account>) => Effect.Effect<Account, AccountNotFound>) =>
	Option.match({
		onNone: () =>
			Effect.fail(
				new AccountNotFound(organizationId.toString(), ledgerId.toString(), accountId.toString())
			),
		onSome: Effect.succeed,
	});

class AccountService {
	constructor(
		private readonly repo: AccountRepo,
		private readonly ledgerService: LedgerService
	) {}

	listAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
	): Effect.Effect<Account[], AccountListError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(Effect.andThen(this.repo.listAccounts(organizationId, ledgerId, query)));
	}

	getAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Account, AccountGetError> {
		return this.repo
			.getAccount(organizationId, ledgerId, accountId)
			.pipe(Effect.flatMap(requireFound(organizationId, ledgerId, accountId)));
	}

	createAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: AccountCreateRequest
	): Effect.Effect<Account, AccountCreateError> {
		return Effect.gen(
			function* (this: AccountService) {
				yield* this.ledgerService.getLedger(organizationId, ledgerId);
				const id = yield* Effect.sync(() => new TypeID("lat") as LedgerAccountID);
				const account = yield* Effect.try({
					try: () => Account.fromRequest(id, organizationId, ledgerId, request),
					catch: cause => new BadRequestError("Invalid Account Currency", { cause }),
				});
				return yield* this.repo.createAccount(account).pipe(
					Effect.mapError(error =>
						error instanceof AccountRepositoryUnavailable
							? new ServiceUnavailableError(error.message, {
									...error.context,
									cause: error,
									retryable: false,
								})
							: error
					)
				);
			}.bind(this)
		);
	}

	updateAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		request: AccountUpdateRequest
	): Effect.Effect<Account, AccountUpdateError> {
		return this.getAccount(organizationId, ledgerId, accountId).pipe(
			Effect.flatMap(current => {
				const account = current.updateFromRequest(request);
				return this.repo.updateAccount(account);
			})
		);
	}

	deleteAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Account, AccountDeleteError> {
		return this.repo
			.deleteAccount(organizationId, ledgerId, accountId)
			.pipe(Effect.flatMap(requireFound(organizationId, ledgerId, accountId)));
	}
}

const AccountServiceTag = Context.Service<AccountService>("AccountService");

const accountServiceLayer = Layer.effect(
	AccountServiceTag,
	Effect.gen(function* () {
		const repository = yield* AccountRepoTag;
		const ledgerService = yield* LedgerServiceTag;
		return new AccountService(repository, ledgerService);
	})
);

export type {
	AccountCreateError,
	AccountDeleteError,
	AccountGetError,
	AccountListError,
	AccountUpdateError,
};
export { AccountService, AccountServiceTag, accountServiceLayer };
