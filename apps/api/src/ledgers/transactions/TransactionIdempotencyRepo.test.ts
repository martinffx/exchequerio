import { Effect, Result } from "effect";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { newLedgerTransactionID, newOrgID } from "@/repo/entities/types";
import { makeServerRuntimeLayer, ServerRuntime } from "@/runtime";
import { buildServer } from "@/server";

import { TransactionIdempotencyUnavailable } from "./TransactionErrors";
import {
	makeTransactionIdempotencyRepo,
	makeTransactionIdempotencyRepoLive,
	type TransactionIdempotencyRepo,
	TransactionIdempotencyRepoTag,
} from "./TransactionIdempotencyRepo";

const TTL_SECONDS = 24 * 60 * 60;

const fixture = () => {
	const organizationId = newOrgID();
	const transactionId = newLedgerTransactionID();
	const key = `opaque:${crypto.randomUUID()}`;
	const redisKey = `exchequer:transactions:idempotency:${organizationId.toString()}:${key}`;
	return { organizationId, transactionId, key, redisKey };
};

describe("TransactionIdempotencyRepo", () => {
	const config = new Config();
	const client = new Redis(config.valkeyUrl);

	beforeAll(async () => {
		await client.ping();
	});

	afterAll(() => {
		client.disconnect();
	});

	const run = <A>(
		effect: Effect.Effect<A, TransactionIdempotencyUnavailable, TransactionIdempotencyRepo>
	) => Effect.runPromise(effect.pipe(Effect.provide(makeTransactionIdempotencyRepo(client))));

	it.each([
		{
			name: "looks up misses and hits with the Organization-scoped key",
			run: async () => {
				const value = fixture();
				expect(
					await run(
						TransactionIdempotencyRepoTag.use(repo => repo.lookup(value.organizationId, value.key))
					)
				).toBeUndefined();
				await client.set(value.redisKey, value.transactionId.toString());
				expect(
					(
						await run(
							TransactionIdempotencyRepoTag.use(repo => repo.lookup(value.organizationId, value.key))
						)
					)?.toString()
				).toBe(value.transactionId.toString());
			},
		},
		{
			name: "claims atomically and returns the existing winner on loss",
			run: async () => {
				const value = fixture();
				const loser = newLedgerTransactionID();
				const claim = (transactionId: typeof value.transactionId) =>
					run(
						TransactionIdempotencyRepoTag.use(repo =>
							repo.claim(value.organizationId, value.key, transactionId)
						)
					);
				expect((await claim(value.transactionId)).toString()).toBe(value.transactionId.toString());
				expect((await claim(loser)).toString()).toBe(value.transactionId.toString());
				expect(await client.get(value.redisKey)).toBe(value.transactionId.toString());
				expect(await client.ttl(value.redisKey)).toBeGreaterThanOrEqual(TTL_SECONDS - 2);
			},
		},
		{
			name: "repopulates with the standard TTL and returns the canonical ID",
			run: async () => {
				const value = fixture();
				const result = await run(
					TransactionIdempotencyRepoTag.use(repo =>
						repo.repopulate(value.organizationId, value.key, value.transactionId)
					)
				);
				expect(result.toString()).toBe(value.transactionId.toString());
				expect(await client.get(value.redisKey)).toBe(value.transactionId.toString());
				expect(await client.ttl(value.redisKey)).toBeGreaterThanOrEqual(TTL_SECONDS - 2);
			},
		},
		{
			name: "cleans up only the caller's uncommitted claim",
			run: async () => {
				const value = fixture();
				const other = newLedgerTransactionID();
				await client.set(value.redisKey, value.transactionId.toString());
				await run(
					TransactionIdempotencyRepoTag.use(repo => repo.cleanup(value.organizationId, value.key, other))
				);
				expect(await client.get(value.redisKey)).toBe(value.transactionId.toString());
				await run(
					TransactionIdempotencyRepoTag.use(repo =>
						repo.cleanup(value.organizationId, value.key, value.transactionId)
					)
				);
				expect(await client.get(value.redisKey)).toBeNull();
			},
		},
		{
			name: "allows expired mappings to become misses",
			run: async () => {
				const value = fixture();
				await run(
					TransactionIdempotencyRepoTag.use(repo =>
						repo.repopulate(value.organizationId, value.key, value.transactionId)
					)
				);
				await client.pexpire(value.redisKey, 5);
				await new Promise(resolve => setTimeout(resolve, 10));
				await expect(client.get(value.redisKey)).resolves.toBeNull();
				expect(
					await run(
						TransactionIdempotencyRepoTag.use(repo => repo.lookup(value.organizationId, value.key))
					)
				).toBeUndefined();
			},
		},
		{
			name: "translates command failures",
			run: async () => {
				const value = fixture();
				await client.lpush(value.redisKey, "wrong-type");
				const result = await Effect.runPromise(
					TransactionIdempotencyRepoTag.use(repo => repo.lookup(value.organizationId, value.key)).pipe(
						Effect.result,
						Effect.provide(makeTransactionIdempotencyRepo(client))
					)
				);
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure).toBeInstanceOf(TransactionIdempotencyUnavailable);
					expect(result.failure.organizationId).toBe(value.organizationId.toString());
					expect(result.failure.idempotencyKey).toBe(value.key);
				}
			},
		},
		{
			name: "rejects wrong-prefix, malformed, and noncanonical stored Transaction IDs",
			run: async () => {
				const corruptValues = [
					newOrgID().toString(),
					"not-a-typeid",
					newLedgerTransactionID().toString().toUpperCase(),
				];
				for (const corruptValue of corruptValues) {
					const value = fixture();
					await client.set(value.redisKey, corruptValue);
					const result = await Effect.runPromise(
						TransactionIdempotencyRepoTag.use(repo => repo.lookup(value.organizationId, value.key)).pipe(
							Effect.result,
							Effect.provide(makeTransactionIdempotencyRepo(client))
						)
					);
					expect(Result.isFailure(result)).toBe(true);
					if (Result.isFailure(result)) {
						expect(result.failure).toBeInstanceOf(TransactionIdempotencyUnavailable);
						expect(result.failure.organizationId).toBe(value.organizationId.toString());
						expect(result.failure.idempotencyKey).toBe(value.key);
					}
				}
			},
		},
		{
			name: "translates connection failures without making runtime construction eager",
			run: async () => {
				const value = fixture();
				const unavailableConfig = new Config({ valkeyUrl: "redis://127.0.0.1:1" });
				const server = await buildServer({
					runtimeLayer: makeServerRuntimeLayer(unavailableConfig),
				});
				try {
					expect((await server.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
					const repo = await server.runtime.runPromise(TransactionIdempotencyRepoTag);
					const result = await server.runtime.runPromise(
						repo.lookup(value.organizationId, value.key).pipe(Effect.result)
					);
					expect(Result.isFailure(result)).toBe(true);
					if (Result.isFailure(result)) {
						expect(result.failure).toBeInstanceOf(TransactionIdempotencyUnavailable);
					}
				} finally {
					await server.close();
				}
			},
		},
		{
			name: "leaves injected clients owned by the caller and finalizes one managed client",
			run: async () => {
				const injected = new Redis(config.valkeyUrl);
				await injected.ping();
				await Effect.runPromise(
					Effect.scoped(
						TransactionIdempotencyRepoTag.pipe(Effect.provide(makeTransactionIdempotencyRepo(injected)))
					)
				);
				expect(await injected.ping()).toBe("PONG");
				injected.disconnect();

				let managed: Redis | undefined;
				let clients = 0;
				const runtime = new ServerRuntime(
					makeTransactionIdempotencyRepoLive(config.valkeyUrl, (url, options) => {
						clients += 1;
						managed = new Redis(url, options);
						return managed;
					})
				);
				const first = await runtime.runPromise(TransactionIdempotencyRepoTag);
				const second = await runtime.runPromise(TransactionIdempotencyRepoTag);
				expect(first).toBe(second);
				await runtime.runPromise(first.lookup(newOrgID(), crypto.randomUUID()));
				await runtime.dispose();
				expect(clients).toBe(1);
				expect(managed?.status).toBe("end");
				expect(managed?.listenerCount("error")).toBe(0);
			},
		},
		{
			name: "elects one canonical Transaction ID across concurrent claims",
			run: async () => {
				const value = fixture();
				const candidates = Array.from({ length: 24 }, () => newLedgerTransactionID());
				const results = await Promise.all(
					candidates.map(transactionId =>
						run(
							TransactionIdempotencyRepoTag.use(repo =>
								repo.claim(value.organizationId, value.key, transactionId)
							)
						)
					)
				);
				const winner = await client.get(value.redisKey);
				expect(winner).not.toBeNull();
				expect(new Set(results.map(result => result.toString()))).toEqual(new Set([winner]));
			},
		},
	])("$name", ({ run: testCase }) => testCase());
});
