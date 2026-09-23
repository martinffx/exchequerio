import { Effect, Layer } from "effect";
import { Redis } from "effect/unstable/persistence";
import { RedisJobStore } from "effect-mq/redis";
import { Redis as IoRedis } from "ioredis";

export const makeJobStore = (valkeyUrl: string, options: RedisJobStore.RedisJobStoreOptions) => {
	const redisLayer = Layer.effect(
		Redis.Redis,
		Effect.gen(function* () {
			const client = yield* Effect.acquireRelease(
				Effect.sync(() => {
					const connection = new IoRedis(valkeyUrl, {
						maxRetriesPerRequest: 1,
						connectTimeout: 5000,
						commandTimeout: 5000,
					});
					// Commands surface typed failures; avoid ioredis logging connection credentials.
					connection.on("error", () => undefined);
					return connection;
				}),
				connection => Effect.sync(() => connection.disconnect())
			);
			return yield* Redis.make({
				send: <A = unknown>(command: string, ...args: ReadonlyArray<string>) =>
					Effect.tryPromise({
						try: () => client.call(command, ...args) as Promise<A>,
						catch: cause => new Redis.RedisError({ cause }),
					}),
				subscribe: (channel, onMessage) =>
					Effect.gen(function* () {
						const subscriber = yield* Effect.acquireRelease(
							Effect.sync(() => {
								const connection = client.duplicate();
								connection.on("error", () => undefined);
								return connection;
							}),
							connection => Effect.sync(() => connection.disconnect())
						);
						// ioredis reconnects and restores subscriptions; effect-mq supplies polling fallback.
						subscriber.on("message", (channel, message) => onMessage({ channel, message }));
						yield* Effect.tryPromise({
							try: () => subscriber.subscribe(channel),
							catch: cause => new Redis.RedisError({ cause }),
						});
						return Effect.never;
					}),
			});
		})
	);

	return RedisJobStore.layer(options).pipe(Layer.provide(redisLayer));
};
