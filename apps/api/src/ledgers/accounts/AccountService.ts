import { Context, Effect, Layer, Option } from "effect";
import { TypeID } from "typeid-js";
import { ServiceUnavailableError } from "@/lib/errors";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { type LedgerGetError, LedgerServiceTag, type LedgerService } from "../LedgerService";
import { LedgerAccount } from "./domain/LedgerAccount";
import {
	type AccountInfrastructureError,
	AccountNotFound,
	AccountRepositoryUnavailable,
} from "./AccountErrors";
import {
	type LedgerAccountCreateRepositoryError,
	type LedgerAccountDeleteRepositoryError,
	type LedgerAccountRepo,
	LedgerAccountRepoTag,
	type LedgerAccountUpdateRepositoryError,
} from "./LedgerAccountRepo";
import type { AccountCreateRequest, AccountListQuery, AccountUpdateRequest } from "./AccountSchema";

type AccountListError = AccountInfrastructureError | LedgerGetError;
type AccountGetError = AccountNotFound | AccountInfrastructureError;
type AccountCreateError =
	| Exclude<LedgerAccountCreateRepositoryError, AccountRepositoryUnavailable>
	| LedgerGetError
	| ServiceUnavailableError;
type AccountUpdateError = AccountNotFound | LedgerAccountUpdateRepositoryError;
type AccountDeleteError = AccountNotFound | LedgerAccountDeleteRepositoryError;

const requireFound = (
	organizationId: OrgID,
	ledgerId: LedgerID,
	accountId: LedgerAccountID
): ((account: Option.Option<LedgerAccount>) => Effect.Effect<LedgerAccount, AccountNotFound>) =>
	Option.match({
		onNone: () =>
			Effect.fail(
				new AccountNotFound(organizationId.toString(), ledgerId.toString(), accountId.toString())
			),
		onSome: Effect.succeed,
	});

class AccountService {
	constructor(
		private readonly repo: LedgerAccountRepo,
		private readonly ledgerService: LedgerService
	) {}

	listAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
	): Effect.Effect<LedgerAccount[], AccountListError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(Effect.andThen(this.repo.listAccounts(organizationId, ledgerId, query)));
	}

	getAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<LedgerAccount, AccountGetError> {
		return this.repo
			.getAccount(organizationId, ledgerId, accountId)
			.pipe(Effect.flatMap(requireFound(organizationId, ledgerId, accountId)));
	}

	createAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: AccountCreateRequest
	): Effect.Effect<LedgerAccount, AccountCreateError> {
		return this.ledgerService.getLedger(organizationId, ledgerId).pipe(
			Effect.andThen(Effect.sync(() => new TypeID("lat") as LedgerAccountID)),
			Effect.map(id => LedgerAccount.fromCreateRequest(id, organizationId, ledgerId, request)),
			Effect.flatMap(account =>
				this.repo.createAccount(account).pipe(
					Effect.mapError(error =>
						error instanceof AccountRepositoryUnavailable
							? new ServiceUnavailableError(error.message, {
									...error.context,
									cause: error,
									retryable: false,
								})
							: error
					)
				)
			)
		);
	}

	updateAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		request: AccountUpdateRequest
	): Effect.Effect<LedgerAccount, AccountUpdateError> {
		return this.getAccount(organizationId, ledgerId, accountId).pipe(
			Effect.flatMap(current => this.repo.updateAccount(current.fromUpdateRequest(request)))
		);
	}

	deleteAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<LedgerAccount, AccountDeleteError> {
		return this.repo
			.deleteAccount(organizationId, ledgerId, accountId)
			.pipe(Effect.flatMap(requireFound(organizationId, ledgerId, accountId)));
	}
}

const AccountServiceTag = Context.Service<AccountService>("AccountService");

const accountServiceLayer = Layer.effect(
	AccountServiceTag,
	Effect.gen(function* () {
		const repository = yield* LedgerAccountRepoTag;
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
