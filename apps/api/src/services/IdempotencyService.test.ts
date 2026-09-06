import { Effect, Option } from "effect";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { newOrgID } from "@/repo/entities/types";
import {
	IdempotencyPending,
	type IdempotencyService,
	IdempotencyServiceTag,
	IdempotencyUnavailable,
	makeIdempotencyService,
} from "./IdempotencyService";

const fixture = () => {
	const organizationId = newOrgID();
	const key = crypto.randomUUID();
	const action = "settlements.create";
	return {
		organizationId,
		key,
		action,
		redisKey: `exchequer:idempotency:${organizationId.toString()}:${action}:${key}`,
	};
};
describe("IdempotencyService", () => {
	const client = new Redis(new Config().valkeyUrl);
	const layer = makeIdempotencyService(client);
	beforeAll(() => client.ping());
	afterAll(() => client.disconnect());
	const run = <A, E>(use: (service: IdempotencyService) => Effect.Effect<A, E>) =>
		Effect.runPromise(IdempotencyServiceTag.use(use).pipe(Effect.provide(layer)));
	it("acquires a claim and returns only its completed resource ID on replay", async () => {
		const f = fixture();
		expect(await run(s => s.claim(f.organizationId, f.action, f.key))).toEqual(Option.none());
		expect(await client.ttl(f.redisKey)).toBeGreaterThan(895);
		await run(s => s.complete(f.organizationId, f.action, f.key, "las_result"));
		expect(await run(s => s.claim(f.organizationId, f.action, f.key))).toEqual(
			Option.some("las_result")
		);
		expect(await client.get(f.redisKey)).toBe("las_result");
		expect(await client.ttl(f.redisKey)).toBeLessThanOrEqual(900);
	});
	it("scopes claims by both organization and action", async () => {
		const f = fixture();
		await run(s => s.claim(f.organizationId, f.action, f.key));
		expect(await run(s => s.claim(newOrgID(), f.action, f.key))).toEqual(Option.none());
		expect(await run(s => s.claim(f.organizationId, "transactions.create", f.key))).toEqual(
			Option.none()
		);
	});
	it("bounds waiting on a pending claim", async () => {
		const f = fixture();
		await run(s => s.claim(f.organizationId, f.action, f.key));
		await expect(run(s => s.claim(f.organizationId, f.action, f.key))).rejects.toBeInstanceOf(
			IdempotencyPending
		);
	});
	it("observes completion while waiting", async () => {
		const f = fixture();
		await run(s => s.claim(f.organizationId, f.action, f.key));
		const waiting = run(s => s.claim(f.organizationId, f.action, f.key));
		await run(s => s.complete(f.organizationId, f.action, f.key, "las_result"));
		expect(await waiting).toEqual(Option.some("las_result"));
	});
	it("allows only one concurrent claimant", async () => {
		const f = fixture();
		const results = await Promise.allSettled([
			run(s => s.claim(f.organizationId, f.action, f.key)),
			run(s => s.claim(f.organizationId, f.action, f.key)),
		]);
		expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
		expect(results.find(r => r.status === "rejected")?.reason).toBeInstanceOf(IdempotencyPending);
	});
	it("releases pending claims without deleting completed results", async () => {
		const f = fixture();
		await run(s => s.claim(f.organizationId, f.action, f.key));
		await run(s => s.release(f.organizationId, f.action, f.key));
		expect(await run(s => s.claim(f.organizationId, f.action, f.key))).toEqual(Option.none());
		await run(s => s.complete(f.organizationId, f.action, f.key, "las_result"));
		await run(s => s.release(f.organizationId, f.action, f.key));
		expect(await run(s => s.claim(f.organizationId, f.action, f.key))).toEqual(
			Option.some("las_result")
		);
	});
	it("allows a new claim after expiry", async () => {
		const f = fixture();
		await run(s => s.claim(f.organizationId, f.action, f.key));
		await client.expire(f.redisKey, 0);
		expect(await run(s => s.claim(f.organizationId, f.action, f.key))).toEqual(Option.none());
	});
	it("rejects completion without a pending claim and invalid stored values", async () => {
		const f = fixture();
		await expect(
			run(s => s.complete(f.organizationId, f.action, f.key, "las_result"))
		).rejects.toBeInstanceOf(IdempotencyUnavailable);
		await client.set(f.redisKey, "", "EX", 900);
		await expect(run(s => s.claim(f.organizationId, f.action, f.key))).rejects.toBeInstanceOf(
			IdempotencyUnavailable
		);
	});
	it("maps disconnected-store failures for every operation", async () => {
		const offline = new Redis(new Config().valkeyUrl, { lazyConnect: true });
		offline.disconnect();
		const offlineLayer = makeIdempotencyService(offline);
		const f = fixture();
		for (const use of [
			(s: IdempotencyService) => s.claim(f.organizationId, f.action, f.key).pipe(Effect.asVoid),
			(s: IdempotencyService) => s.complete(f.organizationId, f.action, f.key, "las_result"),
			(s: IdempotencyService) => s.release(f.organizationId, f.action, f.key),
		])
			await expect(
				Effect.runPromise(IdempotencyServiceTag.use(use).pipe(Effect.provide(offlineLayer)))
			).rejects.toBeInstanceOf(IdempotencyUnavailable);
	});
});
