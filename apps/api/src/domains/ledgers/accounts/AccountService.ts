import { Context, Effect, Layer, Option } from "effect";
import { TypeID } from "typeid-js";
import { ServiceUnavailableError } from "@/lib/errors";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { type LedgerGetError, LedgerServiceTag, type LedgerService } from "../LedgerService";
import { LedgerAccount } from "./LedgerAccount";
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

const requireFound = (): ((
	account: Option.Option<LedgerAccount>
) => Effect.Effect<LedgerAccount, AccountNotFound>) =>
	Option.match({
		onNone: () => Effect.fail(new AccountNotFound()),
		onSome: Effect.succeed,
	});

/** Orchestrates Account use cases within an Organization and Ledger. */
class AccountService {
	/**
	 * Creates an Account service.
	 *
	 * @param repo - Repository used for Account persistence.
	 * @param ledgerService - Service used to require the parent Ledger where needed.
	 */
	constructor(
		private readonly repo: LedgerAccountRepo,
		private readonly ledgerService: LedgerService
	) {}

	/**
	 * Requires the parent Ledger, then lists its tenant-scoped Accounts.
	 *
	 * @param organizationId - Organization that owns the Ledger and Accounts.
	 * @param ledgerId - Ledger that contains the Accounts.
	 * @param query - Pagination parameters for the result set.
	 * @returns An Effect containing the requested page of Accounts.
	 */
	listAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
	): Effect.Effect<LedgerAccount[], AccountListError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(Effect.andThen(this.repo.listAccounts(organizationId, ledgerId, query)));
	}

	/**
	 * Gets a tenant-scoped Account and converts repository absence into `AccountNotFound`.
	 *
	 * @param organizationId - Organization that owns the Account.
	 * @param ledgerId - Ledger that contains the Account.
	 * @param accountId - Account to get.
	 * @returns An Effect containing the Account.
	 */
	getAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<LedgerAccount, AccountGetError> {
		return this.repo
			.getAccount(organizationId, ledgerId, accountId)
			.pipe(Effect.flatMap(requireFound()));
	}

	/**
	 * Requires the parent Ledger, generates an identifier, builds an Account, and persists it.
	 *
	 * Repository unavailability is exposed as a non-retryable service-unavailable failure.
	 *
	 * @param organizationId - Organization that owns the Ledger and new Account.
	 * @param ledgerId - Ledger that will contain the Account.
	 * @param request - Validated Account creation request.
	 * @returns An Effect containing the created Account.
	 */
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
									cause: error,
									retryable: false,
								})
							: error
					)
				)
			)
		);
	}

	/**
	 * Loads an Account, applies validated mutable fields, and persists it with optimistic locking.
	 *
	 * @param organizationId - Organization that owns the Account.
	 * @param ledgerId - Ledger that contains the Account.
	 * @param accountId - Account to update.
	 * @param request - Validated Account update request.
	 * @returns An Effect containing the updated Account.
	 */
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

	/**
	 * Deletes a tenant-scoped Account and requires the Account to exist.
	 *
	 * @param organizationId - Organization that owns the Account.
	 * @param ledgerId - Ledger that contains the Account.
	 * @param accountId - Account to delete.
	 * @returns An Effect containing the deleted Account.
	 */
	deleteAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<LedgerAccount, AccountDeleteError> {
		return this.repo
			.deleteAccount(organizationId, ledgerId, accountId)
			.pipe(Effect.flatMap(requireFound()));
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
