import { Context, Effect, Layer } from "effect";
import Redis, { type RedisOptions } from "ioredis";
import { TypeID } from "typeid-js";

import type { LedgerTransactionID, OrgID } from "@/repo/entities/types";

import { TransactionIdempotencyUnavailable } from "./TransactionErrors";

const TTL_SECONDS = 24 * 60 * 60;
const CLAIM_SCRIPT = `
local claimed = redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2], "NX")
if claimed then return ARGV[1] end
return redis.call("GET", KEYS[1])
`;
const CLEANUP_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0
`;
const ignoreManagedClientError = () => undefined;

abstract class TransactionIdempotencyRepo {
	abstract readonly lookup: (
		organizationId: OrgID,
		key: string
	) => Effect.Effect<LedgerTransactionID | undefined, TransactionIdempotencyUnavailable>;
	abstract readonly claim: (
		organizationId: OrgID,
		key: string,
		transactionId: LedgerTransactionID
	) => Effect.Effect<LedgerTransactionID, TransactionIdempotencyUnavailable>;
	abstract readonly repopulate: (
		organizationId: OrgID,
		key: string,
		transactionId: LedgerTransactionID
	) => Effect.Effect<LedgerTransactionID, TransactionIdempotencyUnavailable>;
	abstract readonly cleanup: (
		organizationId: OrgID,
		key: string,
		transactionId: LedgerTransactionID
	) => Effect.Effect<void, TransactionIdempotencyUnavailable>;
}

const TransactionIdempotencyRepoTag = Context.Service<TransactionIdempotencyRepo>(
	"TransactionIdempotencyRepo"
);

const redisKey = (organizationId: OrgID, key: string) =>
	`exchequer:transactions:idempotency:${organizationId.toString()}:${key}`;

const parseTransactionId = (value: unknown): LedgerTransactionID => {
	if (typeof value !== "string") throw new Error("Valkey returned no Transaction ID");
	const parsed = TypeID.fromString(value, "ltr");
	if (parsed.toString() !== value) throw new Error("Valkey returned a noncanonical Transaction ID");
	return parsed as LedgerTransactionID;
};

class TransactionIdempotencyRepoRedis extends TransactionIdempotencyRepo {
	constructor(private readonly client: Redis) {
		super();
	}

	private command<A>(
		organizationId: OrgID,
		key: string,
		operation: () => Promise<A>
	): Effect.Effect<A, TransactionIdempotencyUnavailable> {
		return Effect.tryPromise({
			try: operation,
			catch: cause =>
				new TransactionIdempotencyUnavailable(cause, {
					organizationId: organizationId.toString(),
					idempotencyKey: key,
				}),
		});
	}

	private unavailable(organizationId: OrgID, key: string, cause: unknown) {
		return new TransactionIdempotencyUnavailable(cause, {
			organizationId: organizationId.toString(),
			idempotencyKey: key,
		});
	}

	readonly lookup = (organizationId: OrgID, key: string) =>
		this.command(organizationId, key, () => this.client.get(redisKey(organizationId, key))).pipe(
			Effect.flatMap(value =>
				value === null
					? Effect.succeed(undefined)
					: Effect.try({
							try: () => parseTransactionId(value),
							catch: cause => this.unavailable(organizationId, key, cause),
						})
			)
		);

	readonly claim = (organizationId: OrgID, key: string, candidate: LedgerTransactionID) =>
		this.command(organizationId, key, () =>
			this.client.eval(
				CLAIM_SCRIPT,
				1,
				redisKey(organizationId, key),
				candidate.toString(),
				TTL_SECONDS
			)
		).pipe(
			Effect.flatMap(value =>
				Effect.try({
					try: () => parseTransactionId(value),
					catch: cause => this.unavailable(organizationId, key, cause),
				})
			)
		);

	readonly repopulate = (organizationId: OrgID, key: string, canonicalId: LedgerTransactionID) =>
		this.command(organizationId, key, () =>
			this.client.set(redisKey(organizationId, key), canonicalId.toString(), "EX", TTL_SECONDS)
		).pipe(Effect.as(canonicalId));

	readonly cleanup = (organizationId: OrgID, key: string, claimedId: LedgerTransactionID) =>
		this.command(organizationId, key, () =>
			this.client.eval(CLEANUP_SCRIPT, 1, redisKey(organizationId, key), claimedId.toString())
		).pipe(Effect.asVoid);
}

type RedisFactory = (url: string, options: RedisOptions) => Redis;

const makeTransactionIdempotencyRepo = (client: Redis) =>
	Layer.succeed(TransactionIdempotencyRepoTag, new TransactionIdempotencyRepoRedis(client));

const disconnect = (client: Redis): Effect.Effect<void> =>
	Effect.promise(
		() =>
			new Promise(resolve => {
				if (client.status === "end") return resolve();
				let complete = false;
				const timeout = setTimeout(finish, 1_000);
				function finish() {
					if (complete) return;
					complete = true;
					clearTimeout(timeout);
					client.off("end", finish);
					resolve();
				}
				client.once("end", finish);
				client.disconnect();
			})
	);

const makeTransactionIdempotencyRepoLive = (
	url: string,
	createClient: RedisFactory = (connectionUrl, options) => new Redis(connectionUrl, options)
) =>
	Layer.effect(
		TransactionIdempotencyRepoTag,
		Effect.acquireRelease(
			Effect.sync(() => {
				const client = createClient(url, {
					lazyConnect: true,
					connectTimeout: 1_000,
					commandTimeout: 2_000,
					maxRetriesPerRequest: 1,
					retryStrategy: () => undefined,
				});
				client.on("error", ignoreManagedClientError);
				return client;
			}),
			client =>
				disconnect(client).pipe(
					Effect.ensuring(Effect.sync(() => client.off("error", ignoreManagedClientError)))
				)
		).pipe(Effect.map(client => new TransactionIdempotencyRepoRedis(client)))
	);

export type { RedisFactory };
export {
	makeTransactionIdempotencyRepo,
	makeTransactionIdempotencyRepoLive,
	TransactionIdempotencyRepo,
	TransactionIdempotencyRepoTag,
};
