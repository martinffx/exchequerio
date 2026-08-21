import { Effect, Result } from "effect";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { newLedgerTransactionID, newOrgID } from "@/repo/entities/types";

import { TransactionIdempotencyUnavailable } from "./TransactionErrors";
import {
	makeTransactionIdemService,
	type TransactionIdemService,
	TransactionIdemServiceTag,
} from "./TransactionIdemService";

const TTL_SECONDS = 5 * 60;

const fixture = () => {
	const organizationId = newOrgID();
	const key = `opaque:${crypto.randomUUID()}`;
	const redisKey = `exchequer:transactions:idempotency:${organizationId.toString()}:${key}`;
	return { organizationId, key, redisKey };
};

describe("TransactionIdemService", () => {
	const client = new Redis(new Config().valkeyUrl);
	const layer = makeTransactionIdemService(client);

	beforeAll(async () => {
		await client.ping();
	});

	afterAll(() => {
		client.disconnect();
	});

	const run = <A>(
		effect: Effect.Effect<A, TransactionIdempotencyUnavailable, TransactionIdemService>
	) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

	it("atomically returns one winner and one Transaction ID", async () => {
		const value = fixture();
		const claims = await Promise.all(
			Array.from({ length: 8 }, () =>
				run(
					TransactionIdemServiceTag.use(service =>
						service.claimTransactionId(value.organizationId, value.key)
					)
				)
			)
		);

		expect(
			new Set(
				claims.map(claim =>
					Result.match(claim, {
						onFailure: transactionId => transactionId.toString(),
						onSuccess: transactionId => transactionId.toString(),
					})
				)
			)
		).toHaveLength(1);
		expect(claims.filter(claim => Result.isSuccess(claim))).toHaveLength(1);
		expect(await client.ttl(value.redisKey)).toBeGreaterThanOrEqual(TTL_SECONDS - 2);
	});

	it("only releases the matching claim", async () => {
		const value = fixture();
		const first = await run(
			TransactionIdemServiceTag.use(service =>
				service.claimTransactionId(value.organizationId, value.key)
			)
		);

		await run(
			TransactionIdemServiceTag.use(service =>
				service.releaseTransactionId(value.organizationId, value.key, newLedgerTransactionID())
			)
		);
		const transactionId = Result.getOrThrow(first);
		expect(await client.get(value.redisKey)).toBe(transactionId.toString());

		await run(
			TransactionIdemServiceTag.use(service =>
				service.releaseTransactionId(value.organizationId, value.key, transactionId)
			)
		);
		expect(await client.get(value.redisKey)).toBeNull();
	});

	it("translates malformed stored values", async () => {
		const value = fixture();
		await client.set(value.redisKey, "not-a-typeid");
		const result = await Effect.runPromise(
			TransactionIdemServiceTag.use(service =>
				service.claimTransactionId(value.organizationId, value.key)
			).pipe(Effect.result, Effect.provide(layer))
		);

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(TransactionIdempotencyUnavailable);
			expect(result.failure.organizationId).toBe(value.organizationId.toString());
			expect(result.failure.idempotencyKey).toBe(value.key);
		}
	});
});
