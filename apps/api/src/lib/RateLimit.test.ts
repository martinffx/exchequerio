import { describe, expect, it } from "vitest";
import { Duration, Effect, Layer, Logger, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { RateLimiter } from "effect/unstable/persistence";
import { Authentication, makeAuthenticationLayer, signJWT } from "@/auth";
import { RateLimit, makeRateLimitLayer } from "@/lib/RateLimit";
import { Config } from "@/config";

const PingGroup = HttpApiGroup.make("ping").add(
	HttpApiEndpoint.get("ping", "/ping", { success: Schema.String })
);
class PingApi extends HttpApi.make("ping-test")
	.add(PingGroup)
	.middleware(RateLimit)
	.middleware(Authentication) {}

const orgA = "org_01h2x3y4z5a6b7c8d9e0f1g2h3";
const orgB = "org_01h2x3y4z5a6b7c8d9e0f1g2h4";
const tokenFor = (sub: string) => signJWT({ sub, scope: ["org_user"] });

const failingStore = (consumed: { count: number }) =>
	Layer.succeed(
		RateLimiter.RateLimiterStore,
		RateLimiter.RateLimiterStore.of({
			fixedWindow: () => {
				consumed.count++;
				return Effect.fail(
					new RateLimiter.RateLimiterError({
						reason: new RateLimiter.RateLimitStoreError({ message: "store down" }),
					})
				);
			},
			tokenBucket: () => Effect.die("unused"),
			adaptiveConsume: () => Effect.die("unused"),
			adaptiveFeedback: () => Effect.die("unused"),
		})
	);

const secret = new Config().jwtSecret;

const setup = (
	store: Layer.Layer<RateLimiter.RateLimiterStore>,
	options: { limit: number; window: Duration.Input },
	logs: Array<string> = []
) => {
	const group = HttpApiBuilder.group(PingApi, "ping", handlers =>
		Effect.succeed(handlers.handle("ping", () => Effect.succeed("pong")))
	);
	const logger = Logger.layer([
		Logger.make(({ logLevel, message }) => {
			logs.push(`${logLevel}: ${Array.isArray(message) ? message.join(" ") : String(message)}`);
		}),
	]);
	const { handler, dispose } = HttpRouter.toWebHandler(
		HttpApiBuilder.layer(PingApi).pipe(
			Layer.provide(group),
			Layer.provide(makeRateLimitLayer(options)),
			Layer.provide(makeAuthenticationLayer(secret)),
			Layer.provide(RateLimiter.layer),
			Layer.provide(store),
			Layer.provide(HttpServer.layerServices),
			Layer.provideMerge(logger)
		),
		{ disableLogger: true }
	);
	const get = (token?: string) =>
		handler(
			new Request("http://localhost/ping", {
				headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
			})
		);
	return { get, dispose };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("RateLimit", () => {
	it("rejects the request over the limit with a retryable 429 and retry-after", async () => {
		const { get, dispose } = setup(RateLimiter.layerStoreMemory, { limit: 2, window: "200 millis" });
		try {
			expect((await get(tokenFor(orgA))).status).toBe(200);
			expect((await get(tokenFor(orgA))).status).toBe(200);
			const limited = await get(tokenFor(orgA));
			expect(limited.status).toBe(429);
			const body = (await limited.json()) as { type: string; retryable: boolean };
			expect(body).toMatchObject({ type: "TOO_MANY_REQUESTS", retryable: true });
			expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
		} finally {
			await dispose();
		}
	});

	it("limits each Organization separately", async () => {
		const { get, dispose } = setup(RateLimiter.layerStoreMemory, { limit: 1, window: "5 seconds" });
		try {
			expect((await get(tokenFor(orgA))).status).toBe(200);
			expect((await get(tokenFor(orgA))).status).toBe(429);
			expect((await get(tokenFor(orgB))).status).toBe(200);
		} finally {
			await dispose();
		}
	});

	it("admits the Organization again after its refill time", async () => {
		const { get, dispose } = setup(RateLimiter.layerStoreMemory, { limit: 2, window: "200 millis" });
		try {
			await get(tokenFor(orgA));
			await get(tokenFor(orgA));
			expect((await get(tokenFor(orgA))).status).toBe(429);
			await sleep(300);
			expect((await get(tokenFor(orgA))).status).toBe(200);
		} finally {
			await dispose();
		}
	});

	it("sets rate-limit headers on success", async () => {
		const { get, dispose } = setup(RateLimiter.layerStoreMemory, { limit: 5, window: "10 seconds" });
		try {
			const response = await get(tokenFor(orgA));
			expect(response.status).toBe(200);
			expect(response.headers.get("x-ratelimit-limit")).toBe("5");
			expect(response.headers.get("x-ratelimit-remaining")).toBe("4");
			expect(Number(response.headers.get("x-ratelimit-reset"))).toBeGreaterThanOrEqual(1);
		} finally {
			await dispose();
		}
	});

	it("fails open when the store fails, warning once per outage", async () => {
		const logs: Array<string> = [];
		const consumed = { count: 0 };
		const { get, dispose } = setup(failingStore(consumed), { limit: 1, window: "5 seconds" }, logs);
		try {
			for (let i = 0; i < 3; i++) {
				const response = await get(tokenFor(orgA));
				expect(response.status).toBe(200);
				expect(response.headers.get("x-ratelimit-limit")).toBeNull();
			}
			expect(consumed.count).toBe(3);
			expect(logs.filter(line => line.startsWith("Warn"))).toHaveLength(1);
		} finally {
			await dispose();
		}
	});

	it("answers 401 without consuming a token when there is no token", async () => {
		const { get, dispose } = setup(RateLimiter.layerStoreMemory, { limit: 1, window: "5 seconds" });
		try {
			expect((await get()).status).toBe(401);
			expect((await get(tokenFor(orgA))).status).toBe(200);
		} finally {
			await dispose();
		}
	});
});
