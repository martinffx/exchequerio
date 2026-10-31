import { Effect, Metric } from "effect";

/** Result of one idempotency claim. */
type IdempotencyOutcome = "new" | "replay" | "pending" | "unavailable";
/** Code path that posted a Ledger Transaction. */
type LedgerTransactionPath = "create" | "post" | "settlement";

const idempotencyClaims = Metric.counter("idempotency_claims", {
	description: "Idempotency claims by outcome",
	incremental: true,
});
const ledgerTransactionsPosted = Metric.counter("ledger_transactions_posted", {
	description: "Ledger Transactions posted by path",
	incremental: true,
});

/** Counts one idempotency claim outcome. */
const recordIdempotencyClaim = (outcome: IdempotencyOutcome): Effect.Effect<void> =>
	Metric.update(Metric.withAttributes(idempotencyClaims, { outcome }), 1);

/** Counts one posted Ledger Transaction. */
const recordLedgerTransactionPosted = (path: LedgerTransactionPath): Effect.Effect<void> =>
	Metric.update(Metric.withAttributes(ledgerTransactionsPosted, { path }), 1);

export {
	idempotencyClaims,
	ledgerTransactionsPosted,
	recordIdempotencyClaim,
	recordLedgerTransactionPosted,
};
