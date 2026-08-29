import { Context, Effect, Layer, Result } from "effect";
import type Redis from "ioredis";
import { TypeID } from "typeid-js";

import {
	newLedgerTransactionID,
	type LedgerTransactionID,
	type OrgID,
} from "@/repo/entities/types";

import { TransactionIdempotencyUnavailable } from "./TransactionErrors";

const TTL_SECONDS = 15 * 60;
const CLAIM_SCRIPT = `
local claimed = redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2], "NX")
if claimed then return {1, ARGV[1]} end
return {0, redis.call("GET", KEYS[1])}
`;
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * Result of claiming an idempotency key.
 *
 * Success contains the newly claimed Transaction identifier. Failure contains the
 * identifier already associated with the key.
 */
type TransactionIdClaim = Result.Result<LedgerTransactionID, LedgerTransactionID>;

/** Coordinates Organization-scoped Transaction identifiers through idempotency keys. */
interface TransactionIdemService {
	/**
	 * Atomically claims an idempotency key or returns its existing Transaction identifier.
	 *
	 * A successful Result makes the caller responsible for creating the Transaction. A failed
	 * Result tells the caller to load the Transaction identified by the existing claim. Claims
	 * expire after 15 minutes.
	 *
	 * @param organizationId - Organization that owns the idempotency key.
	 * @param key - Opaque client-provided idempotency key.
	 * @returns An Effect containing the winning or existing Transaction identifier.
	 */
	claimTransactionId(
		organizationId: OrgID,
		key: string
	): Effect.Effect<TransactionIdClaim, TransactionIdempotencyUnavailable>;
	/**
	 * Releases an idempotency claim only when its Transaction identifier matches.
	 *
	 * A mismatched identifier leaves the current claim intact.
	 *
	 * @param organizationId - Organization that owns the idempotency key.
	 * @param key - Opaque client-provided idempotency key.
	 * @param transactionId - Identifier that must match the current claim.
	 * @returns An Effect that completes when the conditional release finishes.
	 */
	releaseTransactionId(
		organizationId: OrgID,
		key: string,
		transactionId: LedgerTransactionID
	): Effect.Effect<void, TransactionIdempotencyUnavailable>;
}

const TransactionIdemServiceTag = Context.Service<TransactionIdemService>("TransactionIdemService");

const redisKey = (organizationId: OrgID, key: string) =>
	`exchequer:transactions:idempotency:${organizationId.toString()}:${key}`;

const parseTransactionId = (value: unknown): LedgerTransactionID => {
	if (typeof value !== "string") throw new Error("Valkey returned no Transaction ID");
	const parsed = TypeID.fromString(value, "ltr");
	if (parsed.toString() !== value) throw new Error("Valkey returned a noncanonical Transaction ID");
	return parsed as LedgerTransactionID;
};

const parseClaim = (value: unknown): TransactionIdClaim => {
	if (!Array.isArray(value) || value.length !== 2 || (value[0] !== 0 && value[0] !== 1)) {
		throw new Error("Valkey returned an invalid Transaction ID claim");
	}
	const transactionId = parseTransactionId(value[1]);
	return value[0] === 1 ? Result.succeed(transactionId) : Result.fail(transactionId);
};

/** Valkey-backed implementation of Transaction idempotency claims. */
class TransactionIdemServiceRedis implements TransactionIdemService {
	/**
	 * Creates a Transaction idempotency service over an existing Valkey client.
	 *
	 * @param client - Connected client used to evaluate atomic claim and release scripts.
	 */
	constructor(private readonly client: Redis) {}

	/**
	 * Claims an Organization-scoped key with a newly generated Transaction identifier.
	 *
	 * The atomic script returns either the winning identifier or the canonical identifier stored
	 * by an earlier caller. Client failures and malformed script results become
	 * `TransactionIdempotencyUnavailable` failures.
	 *
	 * @param organizationId - Organization that owns the idempotency key.
	 * @param key - Opaque client-provided idempotency key.
	 * @returns An Effect containing the winning or existing Transaction identifier.
	 */
	claimTransactionId(
		organizationId: OrgID,
		key: string
	): Effect.Effect<TransactionIdClaim, TransactionIdempotencyUnavailable> {
		return Effect.tryPromise({
			try: async () => {
				const candidate = newLedgerTransactionID();
				const claim = await this.client.eval(
					CLAIM_SCRIPT,
					1,
					redisKey(organizationId, key),
					candidate.toString(),
					TTL_SECONDS
				);
				return parseClaim(claim);
			},
			catch: cause => new TransactionIdempotencyUnavailable(cause),
		});
	}

	/**
	 * Deletes a claim only when it still contains the supplied Transaction identifier.
	 *
	 * @param organizationId - Organization that owns the idempotency key.
	 * @param key - Opaque client-provided idempotency key.
	 * @param transactionId - Identifier that must match the current claim.
	 * @returns An Effect that completes when the conditional release finishes.
	 */
	releaseTransactionId(
		organizationId: OrgID,
		key: string,
		transactionId: LedgerTransactionID
	): Effect.Effect<void, TransactionIdempotencyUnavailable> {
		return Effect.tryPromise({
			try: () =>
				this.client.eval(RELEASE_SCRIPT, 1, redisKey(organizationId, key), transactionId.toString()),
			catch: cause => new TransactionIdempotencyUnavailable(cause),
		}).pipe(Effect.asVoid);
	}
}

/**
 * Provides a Transaction idempotency service backed by an existing Valkey client.
 *
 * @param client - Client used by the service; the Layer does not manage its lifetime.
 * @returns A Layer that provides `TransactionIdemService`.
 */
const makeTransactionIdemService = (client: Redis) =>
	Layer.succeed(TransactionIdemServiceTag, new TransactionIdemServiceRedis(client));

export type { TransactionIdClaim, TransactionIdemService };
export { makeTransactionIdemService, TransactionIdemServiceTag };
