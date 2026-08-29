import { Clock, Context, Effect, Layer, Result, Schedule } from "effect";
import { DateTime } from "luxon";

import { AccountVersionConflict } from "@/domains/ledgers/accounts";
import {
	type LedgerGetError,
	type LedgerService,
	LedgerServiceTag,
} from "@/domains/ledgers/LedgerService";
import {
	newLedgerTransactionID,
	newLedgerTransactionEntryID,
	type LedgerID,
	type LedgerTransactionID,
	type OrgID,
} from "@/repo/entities/types";

import type { LedgerTransaction } from "./LedgerTransaction";
import {
	type TransactionIdemService,
	TransactionIdemServiceTag,
} from "./LedgerTransactionIdemService";
import {
	TransactionConcurrencyFailure,
	TransactionCreationPending,
	type TransactionInfrastructureError,
	TransactionNotFound,
	TransactionPersistenceFailure,
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

const MAX_DISTINCT_ACCOUNTS = 200;
const MUTATION_RETRY_DELAY = "50 millis";
const MUTATION_RETRIES = 40;
const PENDING_RETRY_DELAY = "125 millis";
const PENDING_RETRIES = 3;

const mutationRetrySchedule = Schedule.exponential(MUTATION_RETRY_DELAY).pipe(
	Schedule.jittered,
	Schedule.upTo({ times: MUTATION_RETRIES, duration: "2 seconds" })
);
const pendingRetrySchedule = Schedule.spaced(PENDING_RETRY_DELAY).pipe(
	Schedule.upTo({ times: PENDING_RETRIES, duration: "500 millis" })
);

type TransactionListError = LedgerGetError | TransactionInfrastructureError;
type TransactionGetError = TransactionNotFound | TransactionInfrastructureError;
type TransactionCreateError =
	| TransactionCreationPending
	| TransactionNotFound
	| LedgerTransactionCreateRepositoryError
	| TransactionInfrastructureError;
type TransactionUpdateError = LedgerTransactionUpdateRepositoryError;
type TransactionTransitionError = LedgerTransactionTransitionRepositoryError;

const serverTime = Clock.currentTimeMillis.pipe(
	Effect.map(milliseconds => DateTime.fromMillis(milliseconds, { zone: "utc" }))
);

const isRetryableError = (error: unknown) =>
	error instanceof AccountVersionConflict ||
	error instanceof TransactionVersionConflict ||
	error instanceof TransactionConcurrencyFailure;

const retryMutation = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
	effect.pipe(
		Effect.retry({
			schedule: mutationRetrySchedule,
			while: isRetryableError,
		})
	);

/**
 * Orchestrates Transaction queries, idempotent creation, and lifecycle mutations.
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
	 * @param idempotencyKey - Client key used to lock Transaction creation.
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
	 * Replaces a pending Transaction and its Entries.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to update.
	 * @param request - Validated replacement values and Entries.
	 * @returns An Effect containing the updated Transaction.
	 */
	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionUpdateRequest
	): Effect.Effect<LedgerTransaction, TransactionUpdateError>;
	/**
	 * Posts a Transaction using the service clock.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to post.
	 * @returns An Effect containing the posted Transaction.
	 */
	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<LedgerTransaction, TransactionTransitionError>;
	/**
	 * Voids a Transaction using the service clock.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to void.
	 * @returns An Effect containing the voided Transaction.
	 */
	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<LedgerTransaction, TransactionTransitionError>;
}

/** Effect implementation of the Transaction service contract. */
class TransactionServiceLive implements TransactionService {
	/**
	 * Creates a Transaction service.
	 *
	 * @param repository - Repository used for Transaction and Account persistence.
	 * @param idempotency - Service used to lock and complete idempotent creation.
	 */
	constructor(
		private readonly repository: LedgerTransactionRepo,
		private readonly idempotency: TransactionIdemService,
		private readonly ledgerService: LedgerService
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
	 * Claims a Transaction identifier and creates or loads the Transaction associated with the claim.
	 *
	 * A winning caller performs creation. A losing caller waits for the claimed Transaction to become
	 * readable and receives a creation-pending failure if it remains unavailable.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that will contain the Transaction.
	 * @param idempotencyKey - Client key used for the Organization-scoped claim.
	 * @param request - Validated Transaction creation request.
	 * @returns An Effect containing the newly created or previously claimed Transaction.
	 */
	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		request: TransactionCreateRequest
	): Effect.Effect<LedgerTransaction, TransactionCreateError> {
		return this.idempotency.claimTransactionId(organizationId, idempotencyKey).pipe(
			Effect.flatMap(claim =>
				Result.match(claim, {
					onFailure: transactionId =>
						this.loadClaimedTransaction(organizationId, ledgerId, idempotencyKey, transactionId),
					onSuccess: () =>
						Effect.sync(newLedgerTransactionID).pipe(
							Effect.flatMap(transactionId =>
								this.createClaimedTransaction(
									organizationId,
									ledgerId,
									idempotencyKey,
									transactionId,
									request
								)
							)
						),
				})
			)
		);
	}

	/**
	 * Validates the Account limit, then updates a Transaction with transient concurrency retries.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to update.
	 * @param request - Validated replacement values and Entries.
	 * @returns An Effect containing the updated Transaction.
	 */
	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionUpdateRequest
	): Effect.Effect<LedgerTransaction, TransactionUpdateError> {
		return this.validateAccountLimit(request.ledgerEntries).pipe(
			Effect.andThen(serverTime),
			Effect.flatMap(updated => {
				const entryIds = request.ledgerEntries.map(() => newLedgerTransactionEntryID());
				return retryMutation(
					Effect.suspend(() =>
						this.repository.updateTransaction(
							organizationId,
							ledgerId,
							transactionId,
							request,
							updated,
							entryIds
						)
					)
				);
			})
		);
	}

	/**
	 * Captures the current UTC time and posts a Transaction with transient concurrency retries.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to post.
	 * @returns An Effect containing the posted Transaction.
	 */
	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<LedgerTransaction, TransactionTransitionError> {
		return serverTime.pipe(
			Effect.flatMap(postedAt =>
				retryMutation(
					Effect.suspend(() =>
						this.repository.postTransaction(organizationId, ledgerId, transactionId, postedAt)
					)
				)
			)
		);
	}

	/**
	 * Captures the current UTC time and voids a Transaction with transient concurrency retries.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to void.
	 * @returns An Effect containing the voided Transaction.
	 */
	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<LedgerTransaction, TransactionTransitionError> {
		return serverTime.pipe(
			Effect.flatMap(updated =>
				retryMutation(
					Effect.suspend(() =>
						this.repository.voidTransaction(organizationId, ledgerId, transactionId, updated)
					)
				)
			)
		);
	}

	/**
	 * Waits for the winner of an idempotency claim to store its committed Transaction ID.
	 *
	 * @param organizationId - Organization that owns the claimed Transaction.
	 * @param ledgerId - Ledger that contains the claimed Transaction.
	 * @param transactionId - Committed identifier stored in the claim, when already available.
	 * @returns An Effect containing the claimed Transaction, or a creation-pending failure after the bounded wait.
	 */
	private loadClaimedTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		transactionId: LedgerTransactionID | undefined
	): Effect.Effect<LedgerTransaction, TransactionCreationPending | TransactionGetError> {
		const loadTransactionId =
			transactionId === undefined
				? Effect.suspend(() => this.idempotency.getTransactionId(organizationId, idempotencyKey)).pipe(
						Effect.flatMap(id =>
							id === undefined ? Effect.fail(new TransactionCreationPending()) : Effect.succeed(id)
						),
						Effect.retry({
							schedule: pendingRetrySchedule,
							while: error => error instanceof TransactionCreationPending,
						})
					)
				: Effect.succeed(transactionId);

		return loadTransactionId.pipe(
			Effect.flatMap(id => this.getTransaction(organizationId, ledgerId, id))
		);
	}

	/**
	 * Creates a Transaction for a winning claim and releases that claim if creation fails.
	 *
	 * Claim release is best effort so a Valkey failure does not replace the creation failure.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that will contain the Transaction.
	 * @param idempotencyKey - Client key whose claim is released after a failed creation.
	 * @param transactionId - Identifier allocated by the winning claim.
	 * @param request - Validated Transaction creation request.
	 * @returns An Effect containing the created Transaction.
	 */
	private createClaimedTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		transactionId: LedgerTransactionID,
		request: TransactionCreateRequest
	): Effect.Effect<LedgerTransaction, TransactionCreateError> {
		const create = this.validateAccountLimit(request.ledgerEntries).pipe(
			Effect.andThen(serverTime),
			Effect.flatMap(created => {
				const entryIds = request.ledgerEntries.map(() => newLedgerTransactionEntryID());
				return retryMutation(
					Effect.suspend(() =>
						this.repository.createTransaction(
							organizationId,
							ledgerId,
							transactionId,
							request,
							created,
							entryIds
						)
					)
				);
			}),
			Effect.tapError(error =>
				error instanceof TransactionPersistenceFailure ||
				error instanceof TransactionRepositoryUnavailable
					? Effect.void
					: this.idempotency.releaseTransactionId(organizationId, idempotencyKey).pipe(Effect.ignore)
			)
		);

		return create.pipe(
			Effect.flatMap(transaction =>
				this.idempotency
					.completeTransactionId(organizationId, idempotencyKey, transaction.id)
					.pipe(Effect.as(transaction))
			)
		);
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

const TransactionServiceTag = Context.Service<TransactionService>("TransactionService");

const transactionServiceLayer = Layer.effect(
	TransactionServiceTag,
	LedgerTransactionRepoTag.pipe(
		Effect.flatMap(repository =>
			Effect.all([TransactionIdemServiceTag, LedgerServiceTag]).pipe(
				Effect.map(
					([idempotency, ledgerService]) =>
						new TransactionServiceLive(repository, idempotency, ledgerService)
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
