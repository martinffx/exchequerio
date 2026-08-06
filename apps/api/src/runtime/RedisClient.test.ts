import { Effect } from "effect";
import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import { Config } from "../Config";
import {
	RedisClientTag,
	makeRedisClientLive,
	makeRedisClientTest,
	redisReconnectDelay,
} from "./RedisClient";

describe("redisReconnectDelay", () => {
	it("keeps reconnecting with capped exponential equal jitter", () => {
		expect([1, 2, 3, 4, 5, 6, 7].map(attempt => redisReconnectDelay(attempt, () => 0))).toEqual([
			25, 50, 100, 200, 400, 800, 1000,
		]);
		expect(redisReconnectDelay(100, () => 0.999)).toBeLessThanOrEqual(2_000);
		expect(redisReconnectDelay(100, () => 0.999)).toBeGreaterThan(0);
	});
});

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
