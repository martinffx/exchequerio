import { Cause, Clock, Context, Effect, Exit, Layer, Option, Schedule } from "effect";
import { DateTime } from "luxon";

import { postgresErrorCode } from "@/db";
import { AccountVersionConflict } from "@/ledgers/accounts";
import { type LedgerGetError, type LedgerService, LedgerServiceTag } from "@/ledgers/LedgerService";
import type { InvalidId } from "@/lib/errors";
import { parseId } from "@/lib/utils";
import {
	newLedgerTransactionEntryID,
	newLedgerTransactionID,
	type LedgerAccountID,
	type LedgerID,
	type LedgerTransactionEntryID,
	type LedgerTransactionID,
	type OrgID,
} from "@/repo/entities/types";

import type { Transaction } from "./domain/Transaction";
import {
	type TransactionIdempotencyRepo,
	TransactionIdempotencyRepoTag,
} from "./TransactionIdempotencyRepo";
import {
	TransactionConcurrencyFailure,
	type TransactionInfrastructureError,
	TransactionNotFound,
	TransactionPersistenceFailure,
	TransactionValidationFailure,
} from "./TransactionErrors";
import {
	type TransactionCreateRepositoryError,
	type TransactionCreateRepositoryInput,
	type TransactionListQuery,
	type TransactionReplaceRepositoryError,
	type TransactionReplaceRepositoryInput,
	type TransactionRepo,
	TransactionRepoTag,
	type TransactionTransitionRepositoryError,
} from "./TransactionRepo";
import type { TransactionCreateRequest, TransactionReplaceRequest } from "./TransactionSchema";

const MAX_DISTINCT_ACCOUNTS = 200;
const WINNER_LOAD_DELAY = "50 millis";
const WINNER_LOAD_RETRIES = 40;
const mutationRetrySchedule = Schedule.recurs(2);
const winnerLoadSchedule = Schedule.recurs(WINNER_LOAD_RETRIES).pipe(
	Schedule.addDelay(() => Effect.succeed(WINNER_LOAD_DELAY))
);

type TransactionIdGenerator = Readonly<{
	transaction: () => Effect.Effect<LedgerTransactionID>;
	entry: () => Effect.Effect<LedgerTransactionEntryID>;
}>;

const liveIdGenerator: TransactionIdGenerator = {
	transaction: () => Effect.sync(newLedgerTransactionID),
	entry: () => Effect.sync(newLedgerTransactionEntryID),
};

type TransactionListError = LedgerGetError | TransactionInfrastructureError;
type TransactionGetError = TransactionNotFound | TransactionInfrastructureError;
type TransactionCreateError =
	| LedgerGetError
	| InvalidId
	| TransactionCreateRepositoryError
	| TransactionInfrastructureError;
type TransactionReplaceError =
	| InvalidId
	| TransactionReplaceRepositoryError
	| TransactionValidationFailure;
type TransactionTransitionError = TransactionTransitionRepositoryError;

const transactionNotFound = (
	organizationId: OrgID,
	ledgerId: LedgerID,
	transactionId: LedgerTransactionID
) =>
	new TransactionNotFound(organizationId.toString(), ledgerId.toString(), transactionId.toString());

const requireTransaction = (
	organizationId: OrgID,
	ledgerId: LedgerID,
	transactionId: LedgerTransactionID
): ((transaction: Option.Option<Transaction>) => Effect.Effect<Transaction, TransactionNotFound>) =>
	Option.match({
		onNone: () => Effect.fail(transactionNotFound(organizationId, ledgerId, transactionId)),
		onSome: Effect.succeed,
	});

const serverTime = Clock.currentTimeMillis.pipe(
	Effect.map(milliseconds => DateTime.fromMillis(milliseconds, { zone: "utc" }))
);

const hasTooManyAccounts = (entries: TransactionCreateRequest["ledgerEntries"]) =>
	new Set(entries.map(entry => entry.accountId)).size > MAX_DISTINCT_ACCOUNTS;

const validateAccountLimit = (
	entries: TransactionCreateRequest["ledgerEntries"]
): Effect.Effect<void, TransactionValidationFailure> =>
	hasTooManyAccounts(entries)
		? Effect.fail(
				new TransactionValidationFailure(
					`Transaction may reference at most ${MAX_DISTINCT_ACCOUNTS} distinct Accounts`
				)
			)
		: Effect.void;

const retryableMutation = (error: unknown): boolean =>
	error instanceof AccountVersionConflict ||
	(error instanceof TransactionConcurrencyFailure &&
		(postgresErrorCode(error.cause) === "40P01" || postgresErrorCode(error.cause) === "40001"));

const hasIdempotencyViolation = (cause: unknown, seen = new Set<object>()): boolean => {
	if (typeof cause !== "object" || cause === null || seen.has(cause)) return false;
	seen.add(cause);
	const value = cause as {
		readonly cause?: unknown;
		readonly code?: unknown;
		readonly constraint?: unknown;
		readonly errors?: unknown;
	};
	if (
		value.code === "23505" &&
		value.constraint === "unique_ledger_transactions_organization_idempotency_key"
	) {
		return true;
	}
	if (hasIdempotencyViolation(value.cause, seen)) return true;
	return (
		Array.isArray(value.errors) && value.errors.some(error => hasIdempotencyViolation(error, seen))
	);
};

const isIdempotencyRace = (error: unknown): error is TransactionConcurrencyFailure =>
	error instanceof TransactionConcurrencyFailure && hasIdempotencyViolation(error.cause);

const retryMutation = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
	effect.pipe(
		Effect.retry({
			schedule: mutationRetrySchedule,
			while: retryableMutation,
		})
	);

class TransactionService {
	constructor(
		private readonly repository: TransactionRepo,
		private readonly idempotency: TransactionIdempotencyRepo,
		private readonly ledgerService: LedgerService,
		private readonly ids: TransactionIdGenerator = liveIdGenerator
	) {}

	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<Transaction[], TransactionListError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(Effect.flatMap(() => this.repository.listTransactions(organizationId, ledgerId, query)));
	}

	getTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Transaction, TransactionGetError> {
		return this.repository
			.getTransaction(organizationId, ledgerId, transactionId)
			.pipe(Effect.flatMap(requireTransaction(organizationId, ledgerId, transactionId)));
	}

	private loadCanonical(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		canonicalId: LedgerTransactionID
	): Effect.Effect<Transaction, TransactionInfrastructureError> {
		const load = Effect.suspend(() =>
			this.repository.getTransactionByIdempotencyKey(organizationId, idempotencyKey)
		).pipe(
			Effect.flatMap(
				Option.match({
					onNone: () =>
						Effect.fail(
							new TransactionPersistenceFailure(new Error("Claimed Transaction is not committed yet"), {
								organizationId: organizationId.toString(),
								ledgerId: ledgerId.toString(),
								transactionId: canonicalId.toString(),
								idempotencyKey,
							})
						),
					onSome: transaction =>
						transaction.id.toString() === canonicalId.toString()
							? Effect.succeed(transaction)
							: Effect.fail(
									new TransactionPersistenceFailure(
										new Error("Idempotency mapping does not match PostgreSQL"),
										{
											organizationId: organizationId.toString(),
											ledgerId: ledgerId.toString(),
											transactionId: canonicalId.toString(),
											idempotencyKey,
										}
									)
								),
				})
			)
		);

		return load.pipe(
			Effect.retry({
				schedule: winnerLoadSchedule,
				while: (error: TransactionInfrastructureError) =>
					error instanceof TransactionPersistenceFailure &&
					error.cause instanceof Error &&
					error.cause.message === "Claimed Transaction is not committed yet",
			})
		);
	}

	private makeEntries(entries: TransactionCreateRequest["ledgerEntries"]) {
		return Effect.all(
			entries.map(entry =>
				Effect.all({
					id: this.ids.entry(),
					accountId: parseId<"lat", LedgerAccountID>("lat", entry.accountId),
				}).pipe(
					Effect.map(({ id, accountId }) => ({
						id,
						accountId,
						direction: entry.direction,
						amount: entry.amount,
						metadata: entry.metadata,
					}))
				)
			),
			{ concurrency: 1 }
		);
	}

	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		request: TransactionCreateRequest
	): Effect.Effect<Transaction, TransactionCreateError> {
		return Effect.gen(
			function* (this: TransactionService) {
				const cachedId = yield* this.idempotency.lookup(organizationId, idempotencyKey);
				if (cachedId !== undefined) {
					return yield* this.loadCanonical(organizationId, ledgerId, idempotencyKey, cachedId);
				}

				yield* validateAccountLimit(request.ledgerEntries);
				yield* this.ledgerService.getLedger(organizationId, ledgerId);
				const candidateId = yield* this.ids.transaction();
				const entries = yield* this.makeEntries(request.ledgerEntries);
				const created = yield* serverTime;
				const canonicalId = yield* this.idempotency.claim(organizationId, idempotencyKey, candidateId);

				if (canonicalId.toString() !== candidateId.toString()) {
					return yield* this.loadCanonical(organizationId, ledgerId, idempotencyKey, canonicalId);
				}

				const input: TransactionCreateRepositoryInput = {
					id: candidateId,
					organizationId,
					ledgerId,
					idempotencyKey,
					status: request.status,
					description: request.description,
					metadata: request.metadata,
					entries,
					...(request.status === "posted" ? { postedAt: created } : {}),
					created,
					updated: created,
				};
				const attempted = yield* retryMutation(
					Effect.suspend(() => this.repository.createTransaction(input))
				).pipe(Effect.exit);
				if (Exit.isSuccess(attempted)) return attempted.value;

				yield* this.idempotency.cleanup(organizationId, idempotencyKey, candidateId);
				const failure = attempted.cause.reasons.find(Cause.isFailReason)?.error;
				if (isIdempotencyRace(failure)) {
					const canonical = yield* this.repository
						.getTransactionByIdempotencyKey(organizationId, idempotencyKey)
						.pipe(
							Effect.flatMap(
								Option.match({
									onNone: () => Effect.fail(failure),
									onSome: Effect.succeed,
								})
							)
						);
					yield* this.idempotency.repopulate(organizationId, idempotencyKey, canonical.id);
					return canonical;
				}
				return yield* Effect.failCause(attempted.cause);
			}.bind(this)
		);
	}

	replaceTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionReplaceRequest
	): Effect.Effect<Transaction, TransactionReplaceError> {
		return Effect.gen(
			function* (this: TransactionService) {
				yield* validateAccountLimit(request.ledgerEntries);
				const entries = yield* this.makeEntries(request.ledgerEntries);
				const updated = yield* serverTime;
				const input: TransactionReplaceRepositoryInput = {
					id: transactionId,
					organizationId,
					ledgerId,
					description: request.description,
					metadata: request.metadata,
					entries,
					updated,
				};
				return yield* retryMutation(Effect.suspend(() => this.repository.replaceTransaction(input)));
			}.bind(this)
		);
	}

	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Transaction, TransactionTransitionError> {
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

	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Transaction, TransactionTransitionError> {
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
}

const TransactionServiceTag = Context.Service<TransactionService>("TransactionService");

const makeTransactionServiceLayer = (ids: TransactionIdGenerator = liveIdGenerator) =>
	Layer.effect(
		TransactionServiceTag,
		Effect.gen(function* () {
			return new TransactionService(
				yield* TransactionRepoTag,
				yield* TransactionIdempotencyRepoTag,
				yield* LedgerServiceTag,
				ids
			);
		})
	);

const transactionServiceLayer = makeTransactionServiceLayer();

export type {
	TransactionCreateError,
	TransactionGetError,
	TransactionIdGenerator,
	TransactionListError,
	TransactionReplaceError,
	TransactionTransitionError,
};
export {
	makeTransactionServiceLayer,
	TransactionService,
	TransactionServiceTag,
	transactionServiceLayer,
};
