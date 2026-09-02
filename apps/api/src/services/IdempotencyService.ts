import { Context, Effect, Layer, Result, Schedule } from "effect";
import type Redis from "ioredis";

import { ConflictError, ServiceUnavailableError } from "@/lib/errors";
import type { OrgID } from "@/repo/entities/types";

const TTL_SECONDS = 15 * 60;
const PENDING = "pending";
const PENDING_RETRY_DELAY = "125 millis";
const PENDING_RETRIES = 3;

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

class IdempotencyUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown) {
		super("Idempotency store unavailable", { cause });
	}
}

class IdempotencyPending extends ConflictError {
	constructor() {
		super("Idempotent operation is still in progress", {
			retryable: true,
			retryAfterSeconds: 1,
		});
	}
}

type IdempotencyClaim = Result.Result<void, string | undefined>;

type IdempotentOperation<A, E, R> = Readonly<{
	organizationId: OrgID;
	action: string;
	key: string;
	execute: Effect.Effect<A, E, R>;
	resultId: (result: A) => string;
	replay: (resultId: string) => Effect.Effect<A, E, R>;
	releaseOnError?: (error: E) => boolean;
}>;

interface IdempotencyService {
	run<A, E, R>(
		operation: IdempotentOperation<A, E, R>
	): Effect.Effect<A, E | IdempotencyPending | IdempotencyUnavailable, R>;
}

const IdempotencyServiceTag = Context.Service<IdempotencyService>("IdempotencyService");

const redisKey = (organizationId: OrgID, action: string, key: string) =>
	`exchequer:idempotency:${organizationId.toString()}:${action}:${key}`;

const parseStoredResultId = (value: unknown): string | undefined => {
	if (value === PENDING) return undefined;
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("Valkey returned an invalid idempotency result ID");
	}
	return value;
};

const parseClaim = (value: unknown): IdempotencyClaim => {
	if (!Array.isArray(value) || value.length !== 2 || (value[0] !== 0 && value[0] !== 1)) {
		throw new Error("Valkey returned an invalid idempotency claim");
	}
	return value[0] === 1 ? Result.succeed(undefined) : Result.fail(parseStoredResultId(value[1]));
};

class IdempotencyServiceRedis implements IdempotencyService {
	constructor(private readonly client: Redis) {}

	run<A, E, R>(
		operation: IdempotentOperation<A, E, R>
	): Effect.Effect<A, E | IdempotencyPending | IdempotencyUnavailable, R> {
		const key = redisKey(operation.organizationId, operation.action, operation.key);
		return this.claim(key).pipe(
			Effect.flatMap(claim =>
				Result.match(claim, {
					onFailure: resultId =>
						resultId === undefined
							? this.awaitResultId(key).pipe(Effect.flatMap(operation.replay))
							: operation.replay(resultId),
					onSuccess: () =>
						operation.execute.pipe(
							Effect.tapError(error =>
								operation.releaseOnError?.(error) === false
									? Effect.void
									: this.release(key).pipe(Effect.ignore)
							),
							Effect.tap(result => this.complete(key, operation.resultId(result)))
						),
				})
			)
		);
	}

	private claim(key: string): Effect.Effect<IdempotencyClaim, IdempotencyUnavailable> {
		return Effect.tryPromise({
			try: async () => parseClaim(await this.client.eval(CLAIM_SCRIPT, 1, key, PENDING, TTL_SECONDS)),
			catch: cause => new IdempotencyUnavailable(cause),
		});
	}

	private getResultId(key: string): Effect.Effect<string | undefined, IdempotencyUnavailable> {
		return Effect.tryPromise({
			try: async () => parseStoredResultId(await this.client.get(key)),
			catch: cause => new IdempotencyUnavailable(cause),
		});
	}

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

	private complete(key: string, resultId: string): Effect.Effect<void, IdempotencyUnavailable> {
		return Effect.tryPromise({
			try: async () => {
				const completed = await this.client.eval(COMPLETE_SCRIPT, 1, key, PENDING, resultId);
				if (completed !== "OK") throw new Error("Valkey no longer contains the pending claim");
			},
			catch: cause => new IdempotencyUnavailable(cause),
		});
	}

	private release(key: string): Effect.Effect<void, IdempotencyUnavailable> {
		return Effect.tryPromise({
			try: () => this.client.eval(RELEASE_SCRIPT, 1, key, PENDING),
			catch: cause => new IdempotencyUnavailable(cause),
		}).pipe(Effect.asVoid);
	}
}

const makeIdempotencyService = (client: Redis) =>
	Layer.succeed(IdempotencyServiceTag, new IdempotencyServiceRedis(client));

export type { IdempotencyService, IdempotentOperation };
export {
	IdempotencyPending,
	IdempotencyServiceTag,
	IdempotencyUnavailable,
	makeIdempotencyService,
};
