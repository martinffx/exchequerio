import { Clock, Context, Effect, Layer, Option, Schedule } from "effect";
import { DateTime } from "luxon";

import {
	AssetServiceTag,
	type AssetService,
	type AssetGetError,
} from "@/domains/assets/AssetService";
import { AccountVersionConflict } from "@/domains/ledgers/accounts";
import {
	type LedgerGetError,
	type LedgerService,
	LedgerServiceTag,
} from "@/domains/ledgers/LedgerService";
import type { InvalidId } from "@/lib/errors";
import { parseId } from "@/lib/utils";
import {
	newLedgerTransactionID,
	newLedgerTransactionEntryID,
	type AssetID,
	type LedgerID,
	type LedgerTransactionID,
	type OrgID,
} from "@/lib/ids";

import { LedgerTransaction } from "./LedgerTransaction";
import {
	IdempotencyPending,
	type IdempotencyService,
	IdempotencyServiceTag,
	IdempotencyUnavailable,
} from "@/lib/IdempotencyService";
import {
	TransactionConcurrencyFailure,
	type TransactionInfrastructureError,
	TransactionNotFound,
	TransactionPersistenceFailure,
	TransactionPersistenceDecodingFailure,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
	TransactionVersionConflict,
	requireTransaction,
} from "./LedgerTransactionErrors";
import {
	type LedgerTransactionCreateRepositoryError,
	type LedgerTransactionRepo,
	LedgerTransactionRepoTag,
	type LedgerTransactionTransitionRepositoryError,
	type LedgerTransactionUpdateRepositoryError,
} from "./LedgerTransactionRepo";
import type {
	TransactionCreateRequest,
	TransactionListQuery,
	TransactionUpdateRequest,
} from "./LedgerTransactionSchema";

/** Maximum distinct Accounts allowed in one Transaction. */
const MAX_DISTINCT_ACCOUNTS = 200;
/** Initial delay for transient concurrency retries. */
const MUTATION_RETRY_DELAY = "50 millis";
/** Maximum retry count within the mutation time budget. */
const MUTATION_RETRIES = 40;

/** Jittered exponential retries bounded by count and elapsed time. */
const mutationRetrySchedule = Schedule.exponential(MUTATION_RETRY_DELAY).pipe(
	Schedule.jittered,
	Schedule.upTo({ times: MUTATION_RETRIES, duration: "2 seconds" })
);
/** Failures returned while listing scoped Transactions. */
type TransactionListError = LedgerGetError | TransactionInfrastructureError;
/** Failures returned while loading a required Transaction. */
type TransactionGetError = TransactionNotFound | TransactionInfrastructureError;
/** Claim, validation, and persistence failures returned by creation. */
type TransactionCreateError =
	| AssetGetError
	| InvalidId
	| IdempotencyPending
	| IdempotencyUnavailable
	| TransactionNotFound
	| LedgerTransactionCreateRepositoryError
	| TransactionInfrastructureError;
/** Claim and accounting failures returned by replacement. */
type TransactionUpdateError =
	| AssetGetError
	| InvalidId
	| IdempotencyPending
	| IdempotencyUnavailable
	| TransactionGetError
	| LedgerTransactionUpdateRepositoryError;
/** Claim and accounting failures returned by posting or voiding. */
type TransactionTransitionError =
	| IdempotencyPending
	| IdempotencyUnavailable
	| TransactionGetError
	| LedgerTransactionTransitionRepositoryError;

/** Reads the Effect clock as a UTC timestamp. */
const serverTime = Clock.currentTimeMillis.pipe(
	Effect.map(milliseconds => DateTime.fromMillis(milliseconds, { zone: "utc" }))
);

/** Identifies concurrency failures that permit retrying the repository mutation. */
const isRetryableError = (error: unknown) =>
	error instanceof AccountVersionConflict ||
	error instanceof TransactionVersionConflict ||
	error instanceof TransactionConcurrencyFailure;

/** Retries only transient concurrency failures within the mutation time budget. */
const retryMutation = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
	effect.pipe(
		Effect.retry({
			schedule: mutationRetrySchedule,
			while: isRetryableError,
		})
	);

/**
 * Orchestrates Transaction queries and idempotent accounting mutations.
 *
 * Expected failures are returned through each operation's Effect error channel.
 */
interface TransactionService {
	/**
	 * Lists Transactions for one Organization and Ledger.
	 *
	 * @param organizationId - Organization that owns the Transactions.
	 * @param ledgerId - Ledger that contains the Transactions.
	 * @param query - Pagination parameters for the result set.
	 * @returns An Effect containing the requested page of Transactions.
	 */
	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<LedgerTransaction[], TransactionListError>;
	/**
	 * Gets a Transaction and requires it to exist within its tenant scope.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to get.
	 * @returns An Effect containing the Transaction.
	 */
	getTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<LedgerTransaction, TransactionGetError>;
	/**
	 * Creates a Transaction under an Organization-scoped idempotency claim.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that will contain the Transaction.
	 * @param idempotencyKey - Fresh UUID for this creation action; reuse only for its retries.
	 * @param request - Validated Transaction creation request.
	 * @returns An Effect containing the newly created or previously claimed Transaction.
	 */
	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		request: TransactionCreateRequest
	): Effect.Effect<LedgerTransaction, TransactionCreateError>;
	/**
	 * Claims creation for a prepared Transaction or reloads a completed resource.
	 *
	 * @remarks
	 * The service executes the repository mutation and records its result ID explicitly.
	 * Known rejected mutations release the claim; uncertain persistence outcomes retain it.
	 *
	 * @param idempotencyKey - Fresh action UUID, reused for retries of this creation.
	 * @param transaction - Validated Transaction with stable identifiers for retry.
	 * @returns An Effect containing created or reloaded accounting, or a claim/persistence failure.
	 */
	createTransactionEntity(
		idempotencyKey: string,
		transaction: LedgerTransaction
	): Effect.Effect<LedgerTransaction, TransactionCreateError>;
	/**
	 * Replaces a pending Transaction and its Entries.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to update.
	 * @param idempotencyKey - Fresh action UUID; reuse only for retries of this action.
	 * @param request - Validated replacement values and Entries.
	 * @returns An Effect containing the updated Transaction.
	 */
	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		idempotencyKey: string,
		request: TransactionUpdateRequest
	): Effect.Effect<LedgerTransaction, TransactionUpdateError>;
	/**
	 * Posts a Transaction using the service clock.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to post.
	 * @param idempotencyKey - Fresh action UUID; reuse only for retries of this action.
	 * @returns An Effect containing the posted Transaction.
	 */
	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		idempotencyKey: string
	): Effect.Effect<LedgerTransaction, TransactionTransitionError>;
	/**
	 * Voids a Transaction using the service clock.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to void.
	 * @param idempotencyKey - Fresh action UUID; reuse only for retries of this action.
	 * @returns An Effect containing the voided Transaction.
	 */
	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		idempotencyKey: string
	): Effect.Effect<LedgerTransaction, TransactionTransitionError>;
}

/** Effect implementation of the Transaction service contract. */
class TransactionServiceLive implements TransactionService {
	/**
	 * Creates a Transaction service.
	 *
	 * @param repository - Repository used for Transaction and Account persistence.
	 * @param idempotency - Service used to claim actions and store replay identifiers.
	 * @param ledgerService - Scoped Ledger lookup for collection reads.
	 */
	constructor(
		private readonly repository: LedgerTransactionRepo,
		private readonly idempotency: IdempotencyService,
		private readonly ledgerService: LedgerService,
		private readonly assetService: Pick<AssetService, "getAsset">
	) {}

	/**
	 * Lists tenant-scoped Transactions using repository pagination and ordering.
	 *
	 * @param organizationId - Organization that owns the Transactions.
	 * @param ledgerId - Ledger that contains the Transactions.
	 * @param query - Pagination parameters for the result set.
	 * @returns An Effect containing the requested page of Transactions.
	 */
	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<LedgerTransaction[], TransactionListError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(Effect.andThen(this.repository.listTransactions(organizationId, ledgerId, query)));
	}

	/**
	 * Gets a tenant-scoped Transaction and converts repository absence into `TransactionNotFound`.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to get.
	 * @returns An Effect containing the Transaction.
	 */
	getTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<LedgerTransaction, TransactionGetError> {
		return this.repository
			.getTransaction(organizationId, ledgerId, transactionId)
			.pipe(Effect.flatMap(requireTransaction));
	}

	/**
	 * Validates creation input and creates or reloads the Transaction for this action.
	 *
	 * The claim grants execution or returns a stored resource ID for lookup. Pending claims
	 * receive a bounded wait before the idempotency service returns a retryable failure.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that will contain the Transaction.
	 * @param idempotencyKey - Fresh UUID for this creation action; reuse only for its retries.
	 * @param request - Validated Transaction creation request.
	 * @returns An Effect containing the newly created or previously claimed Transaction.
	 */
	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		request: TransactionCreateRequest
	): Effect.Effect<LedgerTransaction, TransactionCreateError> {
		return Effect.gen({ self: this }, function* () {
			yield* this.validateAccountLimit(request.ledgerEntries);
			const action = "transactions.create";
			const claim = yield* this.idempotency.claim(organizationId, action, idempotencyKey);
			if (Option.isSome(claim)) {
				const storedId = yield* parseId<"ltr", LedgerTransactionID>("ltr", claim.value);
				return yield* this.getTransaction(organizationId, ledgerId, storedId);
			}
			const execute = Effect.gen({ self: this }, function* () {
				const ledgerEntries = yield* Effect.forEach(request.ledgerEntries, entry =>
					Effect.gen({ self: this }, function* () {
						const reference =
							entry.assetId === undefined
								? entry.assetCode
								: yield* parseId<"ast", AssetID>("ast", entry.assetId);
						const asset = yield* this.assetService.getAsset(organizationId, reference);
						return { ...entry, ...asset.toSummary() };
					})
				);
				const created = yield* serverTime;
				const transaction = yield* LedgerTransaction.fromCreateRequest(
					newLedgerTransactionID(),
					organizationId,
					ledgerId,
					{
						...request,
						ledgerEntries,
					},
					created,
					request.ledgerEntries.map(() => newLedgerTransactionEntryID())
				);
				return yield* retryMutation(
					Effect.suspend(() => this.repository.createTransaction(transaction))
				);
			});
			const result = yield* execute.pipe(
				Effect.tapError(error =>
					this.releaseFailedMutation(organizationId, action, idempotencyKey, error)
				)
			);
			yield* this.idempotency.complete(organizationId, action, idempotencyKey, result.id.toString());
			return result;
		});
	}

	/**
	 * Claims creation for a prepared Transaction or reloads a completed resource.
	 *
	 * @remarks
	 * The service executes the repository mutation and records its result ID explicitly.
	 * Known rejected mutations release the claim; uncertain persistence outcomes retain it.
	 *
	 * @param idempotencyKey - Fresh action UUID, reused for retries of this creation.
	 * @param transaction - Validated Transaction with stable identifiers for retry.
	 * @returns An Effect containing created or reloaded accounting, or a claim/persistence failure.
	 */
	createTransactionEntity(
		idempotencyKey: string,
		transaction: LedgerTransaction
	): Effect.Effect<LedgerTransaction, TransactionCreateError> {
		return Effect.gen({ self: this }, function* () {
			const organizationId = transaction.organizationId;
			const action = "transactions.create";
			const claim = yield* this.idempotency.claim(organizationId, action, idempotencyKey);
			if (Option.isSome(claim)) {
				const storedId = yield* parseId<"ltr", LedgerTransactionID>("ltr", claim.value);
				return yield* this.getTransaction(organizationId, transaction.ledgerId, storedId);
			}
			const result = yield* retryMutation(
				Effect.suspend(() => this.repository.createTransaction(transaction))
			).pipe(
				Effect.tapError(error =>
					this.releaseFailedMutation(organizationId, action, idempotencyKey, error)
				)
			);
			yield* this.idempotency.complete(organizationId, action, idempotencyKey, result.id.toString());
			return result;
		});
	}

	/**
	 * Validates the Account limit, then updates a Transaction with transient concurrency retries.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to update.
	 * @param idempotencyKey - Fresh action UUID; reuse only for retries of this action.
	 * @param request - Validated replacement values and Entries.
	 * @returns An Effect containing the updated Transaction.
	 */
	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		idempotencyKey: string,
		request: TransactionUpdateRequest
	): Effect.Effect<LedgerTransaction, TransactionUpdateError> {
		return Effect.gen({ self: this }, function* () {
			const action = "transactions.update";
			const claim = yield* this.idempotency.claim(organizationId, action, idempotencyKey);
			if (Option.isSome(claim)) {
				const storedId = yield* parseId<"ltr", LedgerTransactionID>("ltr", claim.value);
				return yield* this.getTransaction(organizationId, ledgerId, storedId);
			}

			const execute = this.validateAccountLimit(request.ledgerEntries).pipe(
				Effect.andThen(
					Effect.forEach(request.ledgerEntries, entry =>
						Effect.gen({ self: this }, function* () {
							const reference =
								entry.assetId === undefined
									? entry.assetCode
									: yield* parseId<"ast", AssetID>("ast", entry.assetId);
							const asset = yield* this.assetService.getAsset(organizationId, reference);
							return { ...entry, ...asset.toSummary() };
						})
					)
				),
				Effect.flatMap(ledgerEntries =>
					serverTime.pipe(Effect.map(updated => ({ updated, ledgerEntries })))
				),
				Effect.flatMap(({ updated, ledgerEntries }) => {
					const entryIds = request.ledgerEntries.map(() => newLedgerTransactionEntryID());
					return retryMutation(
						Effect.suspend(() =>
							this.repository.updateTransaction(
								organizationId,
								ledgerId,
								transactionId,
								{
									...request,
									ledgerEntries,
								},
								updated,
								entryIds
							)
						)
					);
				})
			);
			const result = yield* execute.pipe(
				Effect.tapError(error =>
					this.releaseFailedMutation(organizationId, action, idempotencyKey, error)
				)
			);
			yield* this.idempotency.complete(organizationId, action, idempotencyKey, result.id.toString());
			return result;
		});
	}

	/**
	 * Captures the current UTC time and posts a Transaction with transient concurrency retries.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to post.
	 * @param idempotencyKey - Fresh action UUID; reuse only for retries of this action.
	 * @returns An Effect containing the posted Transaction.
	 */
	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		idempotencyKey: string
	): Effect.Effect<LedgerTransaction, TransactionTransitionError> {
		return Effect.gen({ self: this }, function* () {
			const action = "transactions.post";
			const claim = yield* this.idempotency.claim(organizationId, action, idempotencyKey);
			if (Option.isSome(claim)) {
				const storedId = yield* parseId<"ltr", LedgerTransactionID>("ltr", claim.value);
				return yield* this.getTransaction(organizationId, ledgerId, storedId);
			}

			const execute = serverTime.pipe(
				Effect.flatMap(postedAt =>
					retryMutation(
						Effect.suspend(() =>
							this.repository.postTransaction(organizationId, ledgerId, transactionId, postedAt)
						)
					)
				)
			);
			const result = yield* execute.pipe(
				Effect.tapError(error =>
					this.releaseFailedMutation(organizationId, action, idempotencyKey, error)
				)
			);
			yield* this.idempotency.complete(organizationId, action, idempotencyKey, result.id.toString());
			return result;
		});
	}

	/**
	 * Captures the current UTC time and voids a Transaction with transient concurrency retries.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to void.
	 * @param idempotencyKey - Fresh action UUID; reuse only for retries of this action.
	 * @returns An Effect containing the voided Transaction.
	 */
	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		idempotencyKey: string
	): Effect.Effect<LedgerTransaction, TransactionTransitionError> {
		return Effect.gen({ self: this }, function* () {
			const action = "transactions.void";
			const claim = yield* this.idempotency.claim(organizationId, action, idempotencyKey);
			if (Option.isSome(claim)) {
				const storedId = yield* parseId<"ltr", LedgerTransactionID>("ltr", claim.value);
				return yield* this.getTransaction(organizationId, ledgerId, storedId);
			}

			const execute = serverTime.pipe(
				Effect.flatMap(updated =>
					retryMutation(
						Effect.suspend(() =>
							this.repository.voidTransaction(organizationId, ledgerId, transactionId, updated)
						)
					)
				)
			);
			const result = yield* execute.pipe(
				Effect.tapError(error =>
					this.releaseFailedMutation(organizationId, action, idempotencyKey, error)
				)
			);
			yield* this.idempotency.complete(organizationId, action, idempotencyKey, result.id.toString());
			return result;
		});
	}

	/**
	 * Releases claims only when the mutation outcome is known to have failed.
	 *
	 * @param organizationId - Owning Organization.
	 * @param action - Operation namespace.
	 * @param key - Original client action UUID.
	 * @param error - Mutation failure used to classify uncertainty.
	 * @returns An Effect completing cleanup; release failures are ignored to preserve the original failure.
	 */
	private releaseFailedMutation(organizationId: OrgID, action: string, key: string, error: unknown) {
		return error instanceof TransactionPersistenceDecodingFailure ||
			error instanceof TransactionPersistenceFailure ||
			error instanceof TransactionRepositoryUnavailable
			? Effect.void
			: this.idempotency.release(organizationId, action, key).pipe(Effect.ignore);
	}

	/**
	 * Rejects a Transaction that references more than 200 distinct Accounts.
	 *
	 * @param entries - Entries whose distinct Account identifiers are counted.
	 * @returns An Effect that succeeds with void when the Account limit is satisfied.
	 */
	private validateAccountLimit(
		entries: TransactionCreateRequest["ledgerEntries"]
	): Effect.Effect<void, TransactionValidationFailure> {
		return new Set(entries.map(entry => entry.accountId)).size > MAX_DISTINCT_ACCOUNTS
			? Effect.fail(
					new TransactionValidationFailure(
						`Transaction may reference at most ${MAX_DISTINCT_ACCOUNTS} distinct Accounts`
					)
				)
			: Effect.void;
	}
}

/** Effect service key for Transaction use cases. */
const TransactionServiceTag = Context.Service<TransactionService>("TransactionService");

/** Constructs Transaction orchestration from persistence and idempotency dependencies. */
const transactionServiceLayer = Layer.effect(
	TransactionServiceTag,
	LedgerTransactionRepoTag.pipe(
		Effect.flatMap(repository =>
			Effect.all([IdempotencyServiceTag, LedgerServiceTag, AssetServiceTag]).pipe(
				Effect.map(
					([idempotency, ledgerService, assetService]) =>
						new TransactionServiceLive(repository, idempotency, ledgerService, assetService)
				)
			)
		)
	)
);

export type {
	TransactionCreateError,
	TransactionGetError,
	TransactionListError,
	TransactionService,
	TransactionTransitionError,
	TransactionUpdateError,
};
export { TransactionServiceTag, transactionServiceLayer };
