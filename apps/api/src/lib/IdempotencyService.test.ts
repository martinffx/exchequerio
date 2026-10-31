import { Effect, ManagedRuntime, Metric, Option } from "effect";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { newOrgID } from "@/lib/ids";
import { idempotencyClaims } from "@/lib/metrics";
import {
	IdempotencyPending,
	type IdempotencyService,
	IdempotencyServiceTag,
	IdempotencyUnavailable,
	makeIdempotencyService,
} from "./IdempotencyService";

/** Creates unique action identifiers and their expected Valkey key. */
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
/** Reads the current count of one idempotency claim outcome. */
const claimCount = async (outcome: string) =>
	(await Effect.runPromise(Metric.value(Metric.withAttributes(idempotencyClaims, { outcome }))))
		.count;
/** Runs an action and returns how much each claim outcome counter grew. */
const claimDeltas = async (run: () => Promise<unknown>) => {
	const outcomes = ["new", "replay", "pending", "unavailable"];
	const before = await Promise.all(outcomes.map(o => claimCount(o)));
	await run().catch(() => undefined);
	const after = await Promise.all(outcomes.map(o => claimCount(o)));
	return Object.fromEntries(outcomes.map((o, i) => [o, after[i] - before[i]]));
};
describe("IdempotencyService", () => {
	const client = new Redis(new Config().valkeyUrl);
	const layer = makeIdempotencyService(client);
	const runtime = ManagedRuntime.make(layer);
	let service: IdempotencyService;
	beforeAll(async () => {
		await client.ping();
		service = await runtime.runPromise(IdempotencyServiceTag);
	});
	afterAll(async () => {
		try {
			await runtime.dispose();
		} finally {
			client.disconnect();
		}
	});
	it("acquires a claim and returns only its completed resource ID on replay", async () => {
		const f = fixture();
		expect(await runtime.runPromise(service.claim(f.organizationId, f.action, f.key))).toEqual(
			Option.none()
		);
		expect(await client.ttl(f.redisKey)).toBeGreaterThan(895);
		await runtime.runPromise(service.complete(f.organizationId, f.action, f.key, "las_result"));
		expect(await runtime.runPromise(service.claim(f.organizationId, f.action, f.key))).toEqual(
			Option.some("las_result")
		);
		expect(await client.get(f.redisKey)).toBe("las_result");
		expect(await client.ttl(f.redisKey)).toBeLessThanOrEqual(900);
	});
	it("scopes claims by both organization and action", async () => {
		const f = fixture();
		await runtime.runPromise(service.claim(f.organizationId, f.action, f.key));
		expect(await runtime.runPromise(service.claim(newOrgID(), f.action, f.key))).toEqual(
			Option.none()
		);
		expect(
			await runtime.runPromise(service.claim(f.organizationId, "transactions.create", f.key))
		).toEqual(Option.none());
	});
	it("bounds waiting on a pending claim", async () => {
		const f = fixture();
		await runtime.runPromise(service.claim(f.organizationId, f.action, f.key));
		await expect(
			runtime.runPromise(service.claim(f.organizationId, f.action, f.key))
		).rejects.toBeInstanceOf(IdempotencyPending);
	});
	it("observes completion while waiting", async () => {
		const f = fixture();
		await runtime.runPromise(service.claim(f.organizationId, f.action, f.key));
		const waiting = runtime.runPromise(service.claim(f.organizationId, f.action, f.key));
		await runtime.runPromise(service.complete(f.organizationId, f.action, f.key, "las_result"));
		expect(await waiting).toEqual(Option.some("las_result"));
	});
	it("allows only one concurrent claimant", async () => {
		const f = fixture();
		const results = await Promise.allSettled([
			runtime.runPromise(service.claim(f.organizationId, f.action, f.key)),
			runtime.runPromise(service.claim(f.organizationId, f.action, f.key)),
		]);
		expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
		expect(results.find(r => r.status === "rejected")?.reason).toBeInstanceOf(IdempotencyPending);
	});
	it("releases pending claims without deleting completed results", async () => {
		const f = fixture();
		await runtime.runPromise(service.claim(f.organizationId, f.action, f.key));
		await runtime.runPromise(service.release(f.organizationId, f.action, f.key));
		expect(await runtime.runPromise(service.claim(f.organizationId, f.action, f.key))).toEqual(
			Option.none()
		);
		await runtime.runPromise(service.complete(f.organizationId, f.action, f.key, "las_result"));
		await runtime.runPromise(service.release(f.organizationId, f.action, f.key));
		expect(await runtime.runPromise(service.claim(f.organizationId, f.action, f.key))).toEqual(
			Option.some("las_result")
		);
	});
	it("allows a new claim after expiry", async () => {
		const f = fixture();
		await runtime.runPromise(service.claim(f.organizationId, f.action, f.key));
		await client.expire(f.redisKey, 0);
		expect(await runtime.runPromise(service.claim(f.organizationId, f.action, f.key))).toEqual(
			Option.none()
		);
	});
	it("rejects completion without a pending claim and invalid stored values", async () => {
		const f = fixture();
		await expect(
			runtime.runPromise(service.complete(f.organizationId, f.action, f.key, "las_result"))
		).rejects.toBeInstanceOf(IdempotencyUnavailable);
		await client.set(f.redisKey, "", "EX", 900);
		await expect(
			runtime.runPromise(service.claim(f.organizationId, f.action, f.key))
		).rejects.toBeInstanceOf(IdempotencyUnavailable);
	});
	it("maps disconnected-store failures for every operation", async () => {
		const offline = new Redis(new Config().valkeyUrl, { lazyConnect: true });
		offline.disconnect();
		const offlineRuntime = ManagedRuntime.make(makeIdempotencyService(offline));
		try {
			const offlineService = await offlineRuntime.runPromise(IdempotencyServiceTag);
			const f = fixture();
			for (const use of [
				(s: IdempotencyService) => s.claim(f.organizationId, f.action, f.key).pipe(Effect.asVoid),
				(s: IdempotencyService) => s.complete(f.organizationId, f.action, f.key, "las_result"),
				(s: IdempotencyService) => s.release(f.organizationId, f.action, f.key),
			])
				await expect(offlineRuntime.runPromise(use(offlineService))).rejects.toBeInstanceOf(
					IdempotencyUnavailable
				);
		} finally {
			await offlineRuntime.dispose();
		}
	});
	it("counts exactly one claim outcome per claim", async () => {
		const f = fixture();
		const claim = () => runtime.runPromise(service.claim(f.organizationId, f.action, f.key));
		expect(await claimDeltas(claim)).toEqual({ new: 1, replay: 0, pending: 0, unavailable: 0 });
		expect(await claimDeltas(claim)).toEqual({ new: 0, replay: 0, pending: 1, unavailable: 0 });
		await runtime.runPromise(service.complete(f.organizationId, f.action, f.key, "las_result"));
		expect(await claimDeltas(claim)).toEqual({ new: 0, replay: 1, pending: 0, unavailable: 0 });
		const offline = new Redis(new Config().valkeyUrl, { lazyConnect: true });
		offline.disconnect();
		const offlineRuntime = ManagedRuntime.make(makeIdempotencyService(offline));
		try {
			const offlineService = await offlineRuntime.runPromise(IdempotencyServiceTag);
			expect(
				await claimDeltas(() =>
					offlineRuntime.runPromise(offlineService.claim(f.organizationId, f.action, f.key))
				)
			).toEqual({ new: 0, replay: 0, pending: 0, unavailable: 1 });
		} finally {
			await offlineRuntime.dispose();
		}
	});
});
