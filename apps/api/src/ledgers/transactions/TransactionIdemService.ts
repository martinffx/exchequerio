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

type TransactionIdClaim = Result.Result<LedgerTransactionID, LedgerTransactionID>;

interface TransactionIdemService {
	claimTransactionId(
		organizationId: OrgID,
		key: string
	): Effect.Effect<TransactionIdClaim, TransactionIdempotencyUnavailable>;
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

class TransactionIdemServiceRedis implements TransactionIdemService {
	constructor(private readonly client: Redis) {}

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

const makeTransactionIdemService = (client: Redis) =>
	Layer.succeed(TransactionIdemServiceTag, new TransactionIdemServiceRedis(client));

export type { TransactionIdClaim, TransactionIdemService };
export { makeTransactionIdemService, TransactionIdemServiceTag };
