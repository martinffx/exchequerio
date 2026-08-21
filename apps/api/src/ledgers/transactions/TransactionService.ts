import { Clock, Context, Effect, Layer, Option, Result, Schedule } from "effect";
import { DateTime } from "luxon";

import { postgresErrorCode } from "@/db";
import { AccountVersionConflict } from "@/ledgers/accounts";
import type { LedgerID, LedgerTransactionID, OrgID } from "@/repo/entities/types";

import type { Transaction } from "./domain/Transaction";
import { type TransactionIdemService, TransactionIdemServiceTag } from "./TransactionIdemService";
import {
	TransactionConcurrencyFailure,
	type TransactionInfrastructureError,
	TransactionNotFound,
	TransactionValidationFailure,
	TransactionVersionConflict,
} from "./TransactionErrors";
import {
	type TransactionCreateRepositoryError,
	type TransactionListQuery,
	type TransactionRepo,
	TransactionRepoTag,
	type TransactionTransitionRepositoryError,
	type TransactionUpdateRepositoryError,
} from "./TransactionRepo";
import type { TransactionCreateRequest, TransactionUpdateRequest } from "./TransactionSchema";

const MAX_DISTINCT_ACCOUNTS = 200;
const WINNER_LOAD_DELAY = "50 millis";
const WINNER_LOAD_RETRIES = 40;

const retrySchedule = Schedule.exponential(WINNER_LOAD_DELAY).pipe(
	Schedule.jittered,
	Schedule.upTo({ times: WINNER_LOAD_RETRIES, duration: "2 seconds" })
);

type TransactionListError = TransactionInfrastructureError;
type TransactionGetError = TransactionNotFound | TransactionInfrastructureError;
type TransactionCreateError =
	| TransactionNotFound
	| TransactionCreateRepositoryError
	| TransactionInfrastructureError;
type TransactionUpdateError = TransactionUpdateRepositoryError;
type TransactionTransitionError = TransactionTransitionRepositoryError;

const serverTime = Clock.currentTimeMillis.pipe(
	Effect.map(milliseconds => DateTime.fromMillis(milliseconds, { zone: "utc" }))
);

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
		onSome: transaction => Effect.succeed(transaction),
	});

const isRetryableError = (error: unknown) =>
	error instanceof AccountVersionConflict ||
	error instanceof TransactionVersionConflict ||
	(error instanceof TransactionConcurrencyFailure &&
		(postgresErrorCode(error.cause) === "40P01" || postgresErrorCode(error.cause) === "40001"));

const retryMutation = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
	effect.pipe(
		Effect.retry({
			schedule: retrySchedule,
			while: isRetryableError,
		})
	);

interface TransactionService {
	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<Transaction[], TransactionListError>;
	getTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Transaction, TransactionGetError>;
	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		request: TransactionCreateRequest
	): Effect.Effect<Transaction, TransactionCreateError>;
	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionUpdateRequest
	): Effect.Effect<Transaction, TransactionUpdateError>;
	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Transaction, TransactionTransitionError>;
	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Transaction, TransactionTransitionError>;
}

class TransactionServiceLive implements TransactionService {
	constructor(
		private readonly repository: TransactionRepo,
		private readonly idempotency: TransactionIdemService
	) {}

	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<Transaction[], TransactionListError> {
		return this.repository.listTransactions(organizationId, ledgerId, query);
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

	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		request: TransactionCreateRequest
	): Effect.Effect<Transaction, TransactionCreateError> {
		return this.idempotency.claimTransactionId(organizationId, idempotencyKey).pipe(
			Effect.flatMap(claim =>
				Result.match(claim, {
					onFailure: transactionId =>
						this.loadClaimedTransaction(organizationId, ledgerId, transactionId),
					onSuccess: transactionId =>
						this.createClaimedTransaction(
							organizationId,
							ledgerId,
							idempotencyKey,
							transactionId,
							request
						),
				})
			)
		);
	}

	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionUpdateRequest
	): Effect.Effect<Transaction, TransactionUpdateError> {
		return this.validateAccountLimit(request.ledgerEntries).pipe(
			Effect.andThen(
				retryMutation(
					Effect.suspend(() =>
						this.repository.updateTransaction(organizationId, ledgerId, transactionId, request)
					)
				)
			)
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
	private loadClaimedTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Transaction, TransactionGetError> {
		return Effect.suspend(() => this.getTransaction(organizationId, ledgerId, transactionId)).pipe(
			Effect.retry({
				schedule: retrySchedule,
				while: error => error instanceof TransactionNotFound,
			})
		);
	}

	private createClaimedTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		transactionId: LedgerTransactionID,
		request: TransactionCreateRequest
	): Effect.Effect<Transaction, TransactionCreateError> {
		return this.validateAccountLimit(request.ledgerEntries).pipe(
			Effect.andThen(
				retryMutation(
					Effect.suspend(() =>
						this.repository.createTransaction(organizationId, ledgerId, transactionId, request)
					)
				)
			),
			Effect.onError(() =>
				this.idempotency
					.releaseTransactionId(organizationId, idempotencyKey, transactionId)
					.pipe(Effect.ignore)
			)
		);
	}

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
	Effect.gen(function* () {
		return new TransactionServiceLive(yield* TransactionRepoTag, yield* TransactionIdemServiceTag);
	})
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
