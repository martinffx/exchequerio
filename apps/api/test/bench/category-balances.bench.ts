import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import autocannon from "autocannon";
import { TypeID } from "typeid-js";
import { ManagedRuntime } from "effect";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildServer } from "@/server";
import { Config } from "@/config";
import { DatabaseTag, makeDatabaseLive, type Database } from "@/db";
import { signJWT } from "@/auth";
import {
	AssetsTable,
	OrganizationsTable,
	LedgersTable,
	LedgerAccountsTable,
	LedgerAccountCategoriesTable,
	LedgerAccountCategoryAccountsTable,
	LedgerAccountCategoryParentsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "@/db/schema";

const runtime = ManagedRuntime.make(makeDatabaseLive(new Config().databaseUrl));
const org = new TypeID("org");
const ledger = new TypeID("lgr");
const assets = [new TypeID("ast"), new TypeID("ast")];
const categories = Array.from({ length: 4 }, () => new TypeID("lac"));
const accounts = Array.from({ length: 10_000 }, () => new TypeID("lat"));
const ownership = { organizationId: org.toUUID(), ledgerId: ledger.toUUID() };
let database: Database;
let server: Awaited<ReturnType<typeof buildServer>>;
let baseUrl: string;
let authorization: string;

beforeAll(async () => {
	authorization = `Bearer ${signJWT({ sub: org.toString(), scope: ["super_admin"] })}`;
	database = await runtime.runPromise(DatabaseTag);
	await database.db
		.insert(OrganizationsTable)
		.values({ id: org.toUUID(), name: "Category balance benchmark" });
	await database.db
		.insert(LedgersTable)
		.values({ id: ledger.toUUID(), organizationId: org.toUUID(), name: "Benchmark" });
	await database.db.insert(AssetsTable).values(
		assets.map((id, i) => ({
			id: id.toUUID(),
			organizationId: org.toUUID(),
			code: i === 0 ? "USD" : "EUR",
			name: "Benchmark Asset",
			minorUnitExponent: 2,
		}))
	);
	await database.db.insert(LedgerAccountCategoriesTable).values(
		categories.map(id => ({
			...ownership,
			id: id.toUUID(),
			name: id.toString(),
			normalBalance: "debit" as const,
		}))
	);
	await database.db.insert(LedgerAccountCategoryParentsTable).values(
		[
			[1, 0],
			[2, 0],
			[3, 1],
			[3, 2],
		].map(([child, parent]) => ({
			...ownership,
			categoryId: categories[child].toUUID(),
			parentCategoryId: categories[parent].toUUID(),
		}))
	);
	for (let start = 0; start < accounts.length; start += 500) {
		const batch = accounts.slice(start, start + 500);
		await database.db.insert(LedgerAccountsTable).values(
			batch.map((id, i) => ({
				...ownership,
				id: id.toUUID(),
				name: id.toString(),
				normalBalance: i % 2 === 0 ? ("debit" as const) : ("credit" as const),
				assetId: assets[Math.floor((start + i) / 2) % 2].toUUID(),
			}))
		);
		await database.db
			.insert(LedgerAccountCategoryAccountsTable)
			.values(
				batch.map(id => ({ ...ownership, accountId: id.toUUID(), categoryId: categories[3].toUUID() }))
			);
	}
	await database.db
		.insert(LedgerAccountCategoryAccountsTable)
		.values(
			accounts
				.slice(0, 1000)
				.map(id => ({ ...ownership, accountId: id.toUUID(), categoryId: categories[0].toUUID() }))
		);
	server = await buildServer();
	server.log.level = "silent";
	baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
	if (server) await server.close();
	if (database) {
		await database.db
			.delete(LedgerTransactionEntriesTable)
			.where(eq(LedgerTransactionEntriesTable.organizationId, org.toUUID()));
		await database.db
			.delete(LedgerTransactionsTable)
			.where(eq(LedgerTransactionsTable.organizationId, org.toUUID()));
		await database.db
			.delete(LedgerAccountCategoriesTable)
			.where(eq(LedgerAccountCategoriesTable.organizationId, org.toUUID()));
		await database.db
			.delete(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.organizationId, org.toUUID()));
		await database.db.delete(LedgersTable).where(eq(LedgersTable.organizationId, org.toUUID()));
		await database.db.delete(AssetsTable).where(eq(AssetsTable.organizationId, org.toUUID()));
		await database.db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, org.toUUID()));
	}
	await runtime.dispose();
});

function writes(duration: number) {
	let reported = false;
	return autocannon({
		url: `${baseUrl}/api/ledgers/${ledger.toString()}/transactions`,
		connections: 100,
		duration,
		method: "POST",
		headers: { authorization, "content-type": "application/json" },
		requests: Array.from({ length: 100 }, (_, i) => {
			const pair = i * 2;
			return {
				method: "POST" as const,
				headers: { authorization, "content-type": "application/json" },
				onResponse: (status, body) => {
					if (status >= 400 && !reported) {
						reported = true;
						console.log("Benchmark write error", status, body);
					}
				},
				path: `/api/ledgers/${ledger.toString()}/transactions`,
				body: JSON.stringify({
					status: "posted",
					ledgerEntries: [
						{
							accountId: accounts[pair].toString(),
							assetId: assets[i % 2].toString(),
							direction: "debit",
							amount: "10000",
						},
						{
							accountId: accounts[pair + 1].toString(),
							assetId: assets[i % 2].toString(),
							direction: "credit",
							amount: "10000",
						},
					],
				}),
				setupRequest: request => {
					request.headers = { ...request.headers, "idempotency-key": randomUUID() };
					return request;
				},
			};
		}),
	});
}
const metrics = (result: autocannon.Result) => ({
	requestsPerSecond: result.requests.average,
	successfulRequestsPerSecond: result["2xx"] / result.duration,
	success: result["2xx"],
	non2xx: result.non2xx,
	errors: result.errors,
	timeouts: result.timeouts,
	latency: { p50: result.latency.p50, p97_5: result.latency.p97_5, p99: result.latency.p99 },
});

it("measures Transaction writes with 100 Category reads/sec over 10,000 Accounts", async () => {
	const balanceUrl = `${baseUrl}/api/ledgers/${ledger.toString()}/accounts/categories/${categories[0].toString()}/balances`;
	const probe = await fetch(balanceUrl, { headers: { authorization } });
	expect(probe.status).toBe(200);
	expect(((await probe.json()) as { assets: unknown[] }).assets).toHaveLength(2);
	const warmup = await writes(15);
	console.log("Write warmup", JSON.stringify(metrics(warmup)));
	expect(warmup["2xx"]).toBeGreaterThan(0);
	const before = await writes(30);
	const [loaded, reads] = await Promise.all([
		writes(30),
		autocannon({
			url: balanceUrl,
			connections: 50,
			overallRate: 100,
			duration: 30,
			headers: { authorization },
		}),
	]);
	const after = await writes(30);
	const report = {
		accounts: 10_000,
		categoryReadTarget: 100,
		categoryReadConnections: 50,
		warmupSeconds: 15,
		writeConnections: 100,
		durationSeconds: 30,
		baselineBefore: metrics(before),
		withCategoryReads: metrics(loaded),
		categoryReads: metrics(reads),
		baselineAfter: metrics(after),
	};
	const output = join(tmpdir(), "exchequer-category-balances-benchmark.json");
	await writeFile(output, JSON.stringify(report, undefined, 2) + "\n");
	console.log(`Benchmark results: ${output}`, report);

	for (const result of [before, loaded, reads, after]) {
		expect(result["2xx"]).toBeGreaterThan(0);
		expect(result.errors).toBe(0);
		expect(result.timeouts).toBe(0);
	}
	expect(reads.non2xx).toBe(0);
}, 180_000);
