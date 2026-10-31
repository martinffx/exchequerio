import { afterEach, describe, expect, it, vi } from "vitest";
import { Config } from "./config";

const variables = [
	["RATE_LIMIT_MAX", "rateLimitMax"],
	["RATE_LIMIT_WINDOW_SECONDS", "rateLimitWindowSeconds"],
] as const;

describe("Config rate limit settings", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("defaults to 500 requests per 1 second when neither variable is set", () => {
		vi.stubEnv("RATE_LIMIT_MAX", undefined);
		vi.stubEnv("RATE_LIMIT_WINDOW_SECONDS", undefined);

		const config = new Config();

		expect(config.rateLimitMax).toBe(500);
		expect(config.rateLimitWindowSeconds).toBe(1);
	});

	it("accepts positive integers", () => {
		vi.stubEnv("RATE_LIMIT_MAX", "1000");
		vi.stubEnv("RATE_LIMIT_WINDOW_SECONDS", "30");

		const config = new Config();

		expect(config.rateLimitMax).toBe(1000);
		expect(config.rateLimitWindowSeconds).toBe(30);
	});

	describe.each(variables)("%s", name => {
		it.each(["", "abc", "0", "-1", "1.5"])("rejects %j", value => {
			vi.stubEnv(name, value);

			expect(() => new Config()).toThrow(name);
		});
	});
});
