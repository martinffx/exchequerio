import { Context, Effect, Layer, Option, Result, Schedule } from "effect";
import type Redis from "ioredis";

import { ConflictError, ServiceUnavailableError } from "@/lib/errors";
import type { OrgID } from "@/repo/entities/types";

/** Lifetime of an action claim and its stored result, in seconds. */
const TTL_SECONDS = 15 * 60;
/** Stored sentinel for an acquired action without a completed result. */
const PENDING = "pending";
/** Delay between reads while another caller completes an action. */
const PENDING_RETRY_DELAY = "125 millis";
/** Maximum retries while waiting for a pending result. */
const PENDING_RETRIES = 3;

/** Atomically acquires an expiring claim or returns its current stored value. */
const CLAIM_SCRIPT = `
local claimed = redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2], "NX")
if claimed then return {1, ARGV[1]} end
return {0, redis.call("GET", KEYS[1])}
`;
/** Replaces a pending sentinel with a resource ID while preserving its expiry. */
const COMPLETE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("SET", KEYS[1], ARGV[2], "KEEPTTL")
end
return false
`;
/** Deletes a pending claim while preserving completed resource IDs. */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0
`;

/** The claim store failed or returned an unusable result. */
class IdempotencyUnavailable extends ServiceUnavailableError {
	/**
	 * Retains the underlying store failure.
	 *
	 * @param cause - Connection, protocol, or claim-state failure.
	 */
	constructor(cause: unknown) {
		super("Idempotency store unavailable", { cause });
	}
}

/** Another caller still holds the action claim after bounded polling. */
class IdempotencyPending extends ConflictError {
	/** Creates a retryable conflict with a one-second Retry-After hint. */
	constructor() {
		super("Idempotent operation is still in progress", {
			retryable: true,
			retryAfterSeconds: 1,
		});
	}
}

/** Internal acquisition result: success grants execution; failure carries a result ID or pending state. */
type IdempotencyClaim = Result.Result<void, string | undefined>;

/**
 * Coordinates claims without executing domain operations.
 *
 * @remarks
 * Use a fresh UUID for each client action and reuse it only for retries or internal
 * calls belonging to that action. Callers own execution, replay lookup, and failure cleanup.
 */
interface IdempotencyService {
	/**
	 * Acquires permission to execute or returns a completed resource identifier.
	 *
	 * @param organizationId - Owning Organization.
	 * @param action - Operation namespace.
	 * @param key - Client action UUID, reused only for the same action.
	 * @returns An Effect with None for execution, Some for replay, or a pending/unavailable failure.
	 */
	claim(
		organizationId: OrgID,
		action: string,
		key: string
	): Effect.Effect<Option.Option<string>, IdempotencyPending | IdempotencyUnavailable>;
	/**
	 * Records the persisted resource ID for subsequent replay.
	 *
	 * @param organizationId - Owning Organization.
	 * @param action - Operation namespace.
	 * @param key - Client action UUID, reused only for the same action.
	 * @param resourceId - Resource to reload on replay.
	 * @returns An Effect completing the claim, or an unavailable failure.
	 */
	complete(
		organizationId: OrgID,
		action: string,
		key: string,
		resourceId: string
	): Effect.Effect<void, IdempotencyUnavailable>;
	/**
	 * Releases a pending claim after a known rejected operation.
	 *
	 * @remarks
	 * Retain claims when persistence may have succeeded. Completed results are preserved.
	 *
	 * @param organizationId - Owning Organization.
	 * @param action - Operation namespace.
	 * @param key - Client action UUID, reused only for the same action.
	 * @returns An Effect completing cleanup, or an unavailable failure.
	 */
	release(
		organizationId: OrgID,
		action: string,
		key: string
	): Effect.Effect<void, IdempotencyUnavailable>;
}

/** Effect service key for action claims and replay identifiers. */
const IdempotencyServiceTag = Context.Service<IdempotencyService>("IdempotencyService");

/** Builds an Organization- and action-scoped store key. */
const redisKey = (organizationId: OrgID, action: string, key: string) =>
	`exchequer:idempotency:${organizationId.toString()}:${action}:${key}`;

/**
 * Decodes a stored result or pending sentinel.
 *
 * @param value - Store response.
 * @returns The resource ID, or undefined while pending.
 * @throws Error for a missing or malformed result.
 */
const parseStoredResultId = (value: unknown): string | undefined => {
	if (value === PENDING) return undefined;
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("Valkey returned an invalid idempotency result ID");
	}
	return value;
};

/**
 * Decodes the atomic acquisition response.
 *
 * @param value - Lua script response.
 * @returns Execution permission or the existing claim state.
 * @throws Error for a malformed response.
 */
const parseClaim = (value: unknown): IdempotencyClaim => {
	if (!Array.isArray(value) || value.length !== 2 || (value[0] !== 0 && value[0] !== 1)) {
		throw new Error("Valkey returned an invalid idempotency claim");
	}
	return value[0] === 1 ? Result.succeed(undefined) : Result.fail(parseStoredResultId(value[1]));
};

/** Implements expiring claims with atomic Valkey scripts and bounded pending reads. */
class IdempotencyServiceRedis implements IdempotencyService {
	/**
	 * Creates the store adapter.
	 *
	 * @param client - Connected Redis-compatible client; lifetime belongs to the caller.
	 */
	constructor(private readonly client: Redis) {}

	/**
	 * Acquires an action claim or waits briefly for its stored result.
	 *
	 * @param organizationId - Owning Organization.
	 * @param action - Operation namespace.
	 * @param clientKey - UUID for this client action.
	 * @returns An Effect granting execution, returning a replay ID, or failing pending/unavailable.
	 */
	claim(
		organizationId: OrgID,
		action: string,
		clientKey: string
	): Effect.Effect<Option.Option<string>, IdempotencyPending | IdempotencyUnavailable> {
		const key = redisKey(organizationId, action, clientKey);
		return this.acquire(key).pipe(
			Effect.flatMap(claim =>
				Result.match(claim, {
					onSuccess: () => Effect.succeed(Option.none<string>()),
					onFailure: resultId =>
						resultId === undefined
							? this.awaitResultId(key).pipe(Effect.map(Option.some))
							: Effect.succeed(Option.fromUndefinedOr(resultId)),
				})
			)
		);
	}

	/**
	 * Atomically attempts to acquire an expiring claim.
	 *
	 * @param key - Fully scoped store key.
	 * @returns An Effect containing acquisition state, or an unavailable failure.
	 */
	private acquire(key: string): Effect.Effect<IdempotencyClaim, IdempotencyUnavailable> {
		return Effect.tryPromise({
			try: async () => parseClaim(await this.client.eval(CLAIM_SCRIPT, 1, key, PENDING, TTL_SECONDS)),
			catch: cause => new IdempotencyUnavailable(cause),
		});
	}

	/**
	 * Reads the current result without changing claim ownership.
	 *
	 * @param key - Fully scoped store key.
	 * @returns An Effect containing the result ID or pending state, or an unavailable failure.
	 */
	private getResultId(key: string): Effect.Effect<string | undefined, IdempotencyUnavailable> {
		return Effect.tryPromise({
			try: async () => parseStoredResultId(await this.client.get(key)),
			catch: cause => new IdempotencyUnavailable(cause),
		});
	}

	/**
	 * Polls pending state within the bounded retry schedule.
	 *
	 * @param key - Fully scoped store key.
	 * @returns An Effect containing a result ID, or a pending/unavailable failure.
	 */
	private awaitResultId(
		key: string
	): Effect.Effect<string, IdempotencyPending | IdempotencyUnavailable> {
		const schedule = Schedule.spaced(PENDING_RETRY_DELAY).pipe(
			Schedule.upTo({ times: PENDING_RETRIES, duration: "500 millis" })
		);
		return Effect.suspend(() => this.getResultId(key)).pipe(
			Effect.flatMap(resultId =>
				resultId === undefined ? Effect.fail(new IdempotencyPending()) : Effect.succeed(resultId)
			),
			Effect.retry({ schedule, while: error => error instanceof IdempotencyPending })
		);
	}

	/**
	 * Stores the resource ID only while the claim remains pending.
	 *
	 * @param organizationId - Owning Organization.
	 * @param action - Operation namespace.
	 * @param clientKey - UUID for this client action.
	 * @param resultId - Persisted resource identifier.
	 * @returns An Effect completing the store operation, or an unavailable failure.
	 */
	complete(
		organizationId: OrgID,
		action: string,
		clientKey: string,
		resultId: string
	): Effect.Effect<void, IdempotencyUnavailable> {
		const key = redisKey(organizationId, action, clientKey);
		return Effect.tryPromise({
			try: async () => {
				const completed = await this.client.eval(COMPLETE_SCRIPT, 1, key, PENDING, resultId);
				if (completed !== "OK") throw new Error("Valkey no longer contains the pending claim");
			},
			catch: cause => new IdempotencyUnavailable(cause),
		});
	}

	/**
	 * Removes a pending claim without deleting completed results.
	 *
	 * @param organizationId - Owning Organization.
	 * @param action - Operation namespace.
	 * @param clientKey - UUID for this client action.
	 * @returns An Effect completing the store operation, or an unavailable failure.
	 */
	release(
		organizationId: OrgID,
		action: string,
		clientKey: string
	): Effect.Effect<void, IdempotencyUnavailable> {
		const key = redisKey(organizationId, action, clientKey);
		return Effect.tryPromise({
			try: () => this.client.eval(RELEASE_SCRIPT, 1, key, PENDING),
			catch: cause => new IdempotencyUnavailable(cause),
		}).pipe(Effect.asVoid);
	}
}

/**
 * Provides idempotency using an existing Redis-compatible client.
 *
 * @param client - Client whose connection lifetime is managed by the application.
 * @returns The idempotency service Layer.
 */
const makeIdempotencyService = (client: Redis) =>
	Layer.succeed(IdempotencyServiceTag, new IdempotencyServiceRedis(client));

export type { IdempotencyService };
export {
	IdempotencyPending,
	IdempotencyServiceTag,
	IdempotencyUnavailable,
	makeIdempotencyService,
};
