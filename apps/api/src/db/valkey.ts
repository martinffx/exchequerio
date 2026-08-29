import { Context, Effect, Layer } from "effect";
import Redis, { type RedisOptions } from "ioredis";

abstract class Valkey {
	abstract readonly client: Redis;
}

const ValkeyTag = Context.Service<Valkey>("Valkey");

type RedisFactory = (url: string, options: RedisOptions) => Redis;

const defaultRedisFactory: RedisFactory = (url, options) => new Redis(url, options);
const ignoreManagedClientError = () => undefined;

class ValkeyLive extends Valkey {
	constructor(readonly client: Redis) {
		super();
	}

	close(): Effect.Effect<void> {
		return Effect.promise(
			() =>
				new Promise(resolve => {
					this.client.off("error", ignoreManagedClientError);
					if (this.client.status === "end") return resolve();
					this.client.once("end", resolve);
					this.client.disconnect();
				})
		);
	}
}

const makeValkeyLive = (url: string, createClient: RedisFactory = defaultRedisFactory) =>
	Layer.effect(
		ValkeyTag,
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
				return new ValkeyLive(client);
			}),
			valkey => valkey.close()
		)
	);

export type { RedisFactory };
export { makeValkeyLive, Valkey, ValkeyLive, ValkeyTag };
