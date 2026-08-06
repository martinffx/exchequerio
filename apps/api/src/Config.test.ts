import { afterEach, describe, expect, it, vi } from "vitest";
import { Config } from "./Config";

describe("Config", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("rejects a missing Redis URL", () => {
		vi.stubEnv("REDIS_URL", "");

		expect(() => new Config()).toThrow("REDIS_URL is required");
	});

	it.each(["0", "-1", "1.5", "not-a-number"])(
		"rejects invalid Organization rate-limit maximum %s",
		organizationRateLimitMax => {
			expect(
				() =>
					new Config({
						redisUrl: "redis://localhost:6379",
						organizationRateLimitMax,
					})
			).toThrow("ORGANIZATION_RATE_LIMIT_MAX must be a positive integer");
		}
	);

	it.each(["0", "-1", "1.5", "not-a-number"])(
		"rejects invalid Organization rate-limit window %s",
		organizationRateLimitWindowMs => {
			expect(
				() =>
					new Config({
						redisUrl: "redis://localhost:6379",
						organizationRateLimitWindowMs,
					})
			).toThrow("ORGANIZATION_RATE_LIMIT_WINDOW_MS must be a positive integer");
		}
	);

	it("uses the documented Organization rate-limit defaults", () => {
		vi.stubEnv("ORGANIZATION_RATE_LIMIT_MAX", undefined);
		vi.stubEnv("ORGANIZATION_RATE_LIMIT_WINDOW_MS", undefined);
		const config = new Config({ redisUrl: "redis://localhost:6379" });

		expect(config.organizationRateLimitMax).toBe(1000);
		expect(config.organizationRateLimitWindowMs).toBe(60_000);
	});

	it("accepts explicit valid Organization rate-limit overrides", () => {
		const config = new Config({
			redisUrl: "redis://localhost:6380",
			organizationRateLimitMax: "25",
			organizationRateLimitWindowMs: 5_000,
		});

		expect(config.redisUrl).toBe("redis://localhost:6380");
		expect(config.organizationRateLimitMax).toBe(25);
		expect(config.organizationRateLimitWindowMs).toBe(5_000);
	});
});
