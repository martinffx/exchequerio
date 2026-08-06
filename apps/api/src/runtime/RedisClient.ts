import { Context, Effect, Layer } from "effect";
import Redis, { type RedisOptions } from "ioredis";

abstract class RedisClient {
	abstract readonly client: Redis;
}

const RedisClientTag = Context.Service<RedisClient>("RedisClient");

type RedisFactory = (url: string, options: RedisOptions) => Redis;

const defaultRedisFactory: RedisFactory = (url, options) => new Redis(url, options);

class RedisClientLive extends RedisClient {
	constructor(
		readonly client: Redis,
		private readonly shutdownTimeoutMs: number
	) {
		super();
	}

	close(): Effect.Effect<void> {
		return Effect.promise(
			() =>
				new Promise(resolve => {
					let finished = false;
					let timeout: ReturnType<typeof setTimeout>;
					const finish = () => {
						if (finished) return;
						finished = true;
						clearTimeout(timeout);
						this.client.off("end", finish);
						resolve();
					};
					const force = () => {
						this.client.disconnect();
						finish();
					};
					this.client.once("end", finish);
					timeout = setTimeout(force, this.shutdownTimeoutMs);
					try {
						void this.client.quit().catch(force);
					} catch {
						force();
					}
				})
		);
	}
}

const makeRedisClientLive = (
	url: string,
	createClient: RedisFactory = defaultRedisFactory,
	shutdownTimeoutMs = 1_000
) =>
	Layer.effect(
		RedisClientTag,
		Effect.acquireRelease(
			Effect.sync(
				() =>
					new RedisClientLive(
						createClient(url, {
							lazyConnect: true,
							commandTimeout: 2_000,
							connectTimeout: 2_000,
							disconnectTimeout: 1_000,
							maxRetriesPerRequest: 1,
							retryStrategy: attempts => (attempts > 1 ? undefined : 50),
						}),
						shutdownTimeoutMs
					)
			),
			client => client.close()
		)
	);

const makeRedisClientTest = (client: Redis) => Layer.succeed(RedisClientTag, { client });

export type { RedisFactory };
export { RedisClient, RedisClientLive, RedisClientTag, makeRedisClientLive, makeRedisClientTest };
