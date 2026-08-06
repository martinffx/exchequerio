import { Effect } from "effect";
import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import { Config } from "../Config";
import { RedisClientTag, makeRedisClientLive, makeRedisClientTest } from "./RedisClient";

describe("RedisClient Layers", () => {
	it("acquires lazily, reaches the real Redis service, and closes it", async () => {
		const config = new Config();
		let client: Redis | undefined;
		let statusBeforePing: string | undefined;

		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					client = (yield* RedisClientTag).client;
					statusBeforePing = client.status;
					expect(yield* Effect.promise(() => client!.ping())).toBe("PONG");
				}).pipe(Effect.provide(makeRedisClientLive(config.redisUrl)))
			)
		);

		expect(statusBeforePing).toBe("wait");
		expect(client?.status).toBe("end");
	});

	it("leaves a real externally owned Redis client usable", async () => {
		const client = new Redis(new Config().redisUrl);

		try {
			expect(await client.ping()).toBe("PONG");
			await Effect.runPromise(
				Effect.scoped(RedisClientTag.pipe(Effect.provide(makeRedisClientTest(client))))
			);
			expect(await client.ping()).toBe("PONG");
		} finally {
			client.disconnect();
		}
	});
});
