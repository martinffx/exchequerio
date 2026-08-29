import { Context, Effect, Layer, Result } from "effect";
import type Redis from "ioredis";
import { TypeID } from "typeid-js";

import { type LedgerTransactionID, type OrgID } from "@/repo/entities/types";

import { TransactionIdempotencyUnavailable } from "./LedgerTransactionErrors";

const TTL_SECONDS = 15 * 60;
const PENDING = "pending";
const CLAIM_SCRIPT = `
local claimed = redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2], "NX")
if claimed then return {1, ARGV[1]} end
return {0, redis.call("GET", KEYS[1])}
`;
const COMPLETE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("SET", KEYS[1], ARGV[2], "KEEPTTL")
end
return false
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
 * Success means the caller acquired the pending lock. Failure contains the committed
 * Transaction identifier, or `undefined` while another caller still owns the pending lock.
 */
type TransactionIdClaim = Result.Result<void, LedgerTransactionID | undefined>;

/** Coordinates Organization-scoped Transaction identifiers through idempotency keys. */
interface TransactionIdemService {
	/**
	 * Atomically locks an idempotency key or returns its current state.
	 *
	 * A successful Result makes the caller responsible for creating the Transaction. A failed
	 * Result contains either the committed Transaction ID or `undefined` for a pending lock. Claims
	 * expire after 15 minutes.
	 *
	 * @param organizationId - Organization that owns the idempotency key.
	 * @param key - Opaque client-provided idempotency key.
	 * @returns An Effect containing the lock result.
	 */
	claimTransactionId(
		organizationId: OrgID,
		key: string
	): Effect.Effect<TransactionIdClaim, TransactionIdempotencyUnavailable>;
	getTransactionId(
		organizationId: OrgID,
		key: string
	): Effect.Effect<LedgerTransactionID | undefined, TransactionIdempotencyUnavailable>;
	completeTransactionId(
		organizationId: OrgID,
		key: string,
		transactionId: LedgerTransactionID
	): Effect.Effect<void, TransactionIdempotencyUnavailable>;
	/**
	 * Releases an idempotency claim only while it contains the pending marker.
	 *
	 * A completed claim remains intact.
	 *
	 * @param organizationId - Organization that owns the idempotency key.
	 * @param key - Opaque client-provided idempotency key.
	 * @returns An Effect that completes when the conditional release finishes.
	 */
	releaseTransactionId(
		organizationId: OrgID,
		key: string
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

const parseStoredTransactionId = (value: unknown): LedgerTransactionID | undefined =>
	value === PENDING ? undefined : parseTransactionId(value);

const parseClaim = (value: unknown): TransactionIdClaim => {
	if (!Array.isArray(value) || value.length !== 2 || (value[0] !== 0 && value[0] !== 1)) {
		throw new Error("Valkey returned an invalid Transaction ID claim");
	}
	return value[0] === 1
		? Result.succeed(undefined)
		: Result.fail(parseStoredTransactionId(value[1]));
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
	 * Claims an Organization-scoped key with a pending marker.
	 *
	 * The atomic script returns either a successful lock or the state stored by an earlier caller.
	 * Client failures and malformed script results become
	 * `TransactionIdempotencyUnavailable` failures.
	 *
	 * @param organizationId - Organization that owns the idempotency key.
	 * @param key - Opaque client-provided idempotency key.
	 * @returns An Effect containing the lock result.
	 */
	claimTransactionId(
		organizationId: OrgID,
		key: string
	): Effect.Effect<TransactionIdClaim, TransactionIdempotencyUnavailable> {
		return Effect.tryPromise({
			try: async () => {
				const claim = await this.client.eval(
					CLAIM_SCRIPT,
					1,
					redisKey(organizationId, key),
					PENDING,
					TTL_SECONDS
				);
				return parseClaim(claim);
			},
			catch: cause => new TransactionIdempotencyUnavailable(cause),
		});
	}

	getTransactionId(
		organizationId: OrgID,
		key: string
	): Effect.Effect<LedgerTransactionID | undefined, TransactionIdempotencyUnavailable> {
		return Effect.tryPromise({
			try: async () => parseStoredTransactionId(await this.client.get(redisKey(organizationId, key))),
			catch: cause => new TransactionIdempotencyUnavailable(cause),
		});
	}

	completeTransactionId(
		organizationId: OrgID,
		key: string,
		transactionId: LedgerTransactionID
	): Effect.Effect<void, TransactionIdempotencyUnavailable> {
		return Effect.tryPromise({
			try: async () => {
				const completed = await this.client.eval(
					COMPLETE_SCRIPT,
					1,
					redisKey(organizationId, key),
					PENDING,
					transactionId.toString()
				);
				if (completed !== "OK") throw new Error("Valkey no longer contains the pending lock");
			},
			catch: cause => new TransactionIdempotencyUnavailable(cause),
		});
	}

	/**
	 * Deletes a claim only when it still contains the pending marker.
	 *
	 * @param organizationId - Organization that owns the idempotency key.
	 * @param key - Opaque client-provided idempotency key.
	 * @returns An Effect that completes when the conditional release finishes.
	 */
	releaseTransactionId(
		organizationId: OrgID,
		key: string
	): Effect.Effect<void, TransactionIdempotencyUnavailable> {
		return Effect.tryPromise({
			try: () => this.client.eval(RELEASE_SCRIPT, 1, redisKey(organizationId, key), PENDING),
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
