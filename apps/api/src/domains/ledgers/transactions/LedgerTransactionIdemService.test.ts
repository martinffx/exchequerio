import { Effect, Result } from "effect";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { newLedgerTransactionID, newOrgID } from "@/repo/entities/types";

import { TransactionIdempotencyUnavailable } from "./LedgerTransactionErrors";
import {
	makeTransactionIdemService,
	type TransactionIdemService,
	TransactionIdemServiceTag,
} from "./LedgerTransactionIdemService";

const TTL_SECONDS = 15 * 60;

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

	it("atomically returns one winner and leaves the other claims pending", async () => {
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

		expect(claims.filter(claim => Result.isSuccess(claim))).toHaveLength(1);
		expect(claims.filter(claim => Result.isFailure(claim))).toHaveLength(7);
		expect(await client.get(value.redisKey)).toBe("pending");
		expect(await client.ttl(value.redisKey)).toBeGreaterThanOrEqual(TTL_SECONDS - 2);
	});

	it("stores the Transaction ID only after creation completes", async () => {
		const value = fixture();
		await run(
			TransactionIdemServiceTag.use(service =>
				service.claimTransactionId(value.organizationId, value.key)
			)
		);
		const transactionId = newLedgerTransactionID();

		await run(
			TransactionIdemServiceTag.use(service =>
				service.completeTransactionId(value.organizationId, value.key, transactionId)
			)
		);
		expect(await client.get(value.redisKey)).toBe(transactionId.toString());
		expect(
			await run(
				TransactionIdemServiceTag.use(service =>
					service.getTransactionId(value.organizationId, value.key)
				)
			)
		).toStrictEqual(transactionId);

		await run(
			TransactionIdemServiceTag.use(service =>
				service.releaseTransactionId(value.organizationId, value.key)
			)
		);
		expect(await client.get(value.redisKey)).toBe(transactionId.toString());
	});

	it("releases only a pending claim", async () => {
		const value = fixture();
		await run(
			TransactionIdemServiceTag.use(service =>
				service.claimTransactionId(value.organizationId, value.key)
			)
		);
		await run(
			TransactionIdemServiceTag.use(service =>
				service.releaseTransactionId(value.organizationId, value.key)
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
		}
	});
});
