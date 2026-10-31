import { Effect, ManagedRuntime } from "effect";
import { RateLimiter } from "effect/unstable/persistence";
import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import { Config } from "@/config";
import { newOrgID } from "@/lib/ids";
import { makeRateLimiterLayer, makeServerRuntimeLayer } from "@/runtime";

/** Consumes one token for an Organization through whichever RateLimiter is provided. */
// Explicit values: .env.test's RATE_LIMIT_MAX=1000000 makes the keys expire in about 1 ms.
const consumeOnce = (organizationId: string) =>
	Effect.gen(function* () {
		const limiter = yield* RateLimiter.RateLimiter;
		return yield* limiter.consume({
			key: organizationId,
			limit: 2,
			window: "60 seconds",
			algorithm: "token-bucket",
			onExceeded: "fail",
		});
	});

describe("rate limiter against Valkey", () => {
	it("stores the token bucket and its refill key with a TTL in the server runtime", async () => {
		const config = new Config();
		const organizationId = newOrgID().toString();
		const keys = [
			`exchequer:ratelimit:${organizationId}`,
			`exchequer:ratelimit:${organizationId}:refill`,
		];
		const runtime = ManagedRuntime.make(makeServerRuntimeLayer(config));
		const client = new Redis(config.valkeyUrl);
		try {
			await runtime.runPromise(consumeOnce(organizationId));
			for (const key of keys) {
				expect(await client.exists(key), key).toBe(1);
				expect(await client.pttl(key), key).toBeGreaterThan(0);
			}
		} finally {
			await client.del(...keys);
			client.disconnect();
			await runtime.dispose();
		}
	});

	// Fail-open itself is the middleware's job (covered in RateLimit.test.ts). The speed here comes
	// from enableOfflineQueue: false, not commandTimeout. The full runtime cannot be built against a
	// closed port (the balance-monitor job store calls Valkey while building).
	it("fails fast with a store error when Valkey is unreachable", async () => {
		const runtime = ManagedRuntime.make(makeRateLimiterLayer("redis://127.0.0.1:1"));
		try {
			await runtime.runPromise(Effect.void);
			const started = performance.now();
			const error = await runtime.runPromise(Effect.flip(consumeOnce(newOrgID().toString())));
			const elapsed = performance.now() - started;
			expect(error.reason._tag).toBe("RateLimitStoreError");
			expect(elapsed).toBeLessThan(250 + 250);
		} finally {
			await runtime.dispose();
		}
	}, 15_000);
});
