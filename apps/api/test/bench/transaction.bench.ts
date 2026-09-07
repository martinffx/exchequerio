import { randomUUID } from "node:crypto";

import autocannon from "autocannon";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { retry } from "radash";
import { afterAll, beforeAll, describe, it } from "vitest";
import { TypeID } from "typeid-js";
import { signJWT } from "@/auth";
import { Config } from "@/config";
import type { LedgerID, OrgID } from "@/lib/ids";
import { newLedgerID, newLedgerAccountID } from "@/lib/ids";
import { Ledger } from "@/domains/ledgers/Ledger";
import { LedgerAccount } from "@/domains/ledgers/accounts/LedgerAccount";
import { Effect, Layer, ManagedRuntime } from "effect";
import { DatabaseTag, makeDatabaseLive } from "@/db";
import {
	type LedgerAccountRepo,
	LedgerAccountRepoTag,
	ledgerAccountRepoLayer,
} from "@/domains/ledgers/accounts/LedgerAccountRepo";
import { type LedgerRepo, LedgerRepoTag, ledgerRepoLayer } from "@/domains/ledgers/LedgerRepo";
import { AssetsTable, OrganizationsTable } from "@/db/schema";
import { buildServer } from "@/server";
import type { DrizzleDatabase } from "@/db";

interface BenchmarkScenario {
	name: string;
	accountCount: number;
	accountPairs: Array<{ debitId: string; creditId: string }>;
}

interface BenchmarkResult {
	scenario: string;
	accountCount: number;
	requests: number;
	duration: number;
	throughput: number;
	latency: {
		p50: number;
		p97_5: number;
		p99: number;
		mean: number;
	};
	errors: number;
}

async function setupFixtures(
	ledgerRepo: LedgerRepo,
	accountRepo: LedgerAccountRepo,
	orgId: OrgID,
	assetId: string,
	accountCount: number,
	hotAccountCount: number = 0
): Promise<{
	ledgerId: LedgerID;
	accountPairs: Array<{ debitId: string; creditId: string }>;
}> {
	// Create ledger
	const ledger = await Effect.runPromise(
		ledgerRepo.createLedger(
			Ledger.fromRequest(newLedgerID(), orgId, {
				name: "Benchmark Ledger",
				description: "Ledger for benchmarking",
			})
		)
	);

	const accountPairs: Array<{ debitId: string; creditId: string }> = [];

	if (hotAccountCount > 0) {
		// Hot account pattern: Create hot accounts that all regular accounts transact with
		// Example: 2 hot accounts (fee account debit/credit) + 200 regular accounts
		// All transactions will be: regular account <-> hot account

		// Create hot account pairs
		const hotAccounts: Array<{ debitId: string; creditId: string }> = [];
		const hotPairCount = hotAccountCount / 2;

		for (let i = 0; i < hotPairCount; i++) {
			const hotDebit = await Effect.runPromise(
				accountRepo.createAccount(
					LedgerAccount.fromCreateRequest(
						newLedgerAccountID(),
						orgId,
						ledger.id,
						{
							name: `Hot Debit Account ${i}`,
							description: `Hot debit account ${i} (high contention)`,
							normalBalance: "debit",
							assetId,
						},
						{ assetId, assetCode: "USD", minorUnitExponent: 2 }
					)
				)
			);

			const hotCredit = await Effect.runPromise(
				accountRepo.createAccount(
					LedgerAccount.fromCreateRequest(
						newLedgerAccountID(),
						orgId,
						ledger.id,
						{
							name: `Hot Credit Account ${i}`,
							description: `Hot credit account ${i} (high contention)`,
							normalBalance: "credit",
							assetId,
						},
						{ assetId, assetCode: "USD", minorUnitExponent: 2 }
					)
				)
			);

			hotAccounts.push({
				debitId: hotDebit.id.toString(),
				creditId: hotCredit.id.toString(),
			});
		}

		// Create regular accounts (remaining accounts after hot accounts)
		const regularAccountCount = accountCount - hotAccountCount;

		for (let i = 0; i < regularAccountCount; i++) {
			const regularAccount = await Effect.runPromise(
				accountRepo.createAccount(
					LedgerAccount.fromCreateRequest(
						newLedgerAccountID(),
						orgId,
						ledger.id,
						{
							name: `Regular Account ${i}`,
							description: `Regular account ${i}`,
							normalBalance: i % 2 === 0 ? "debit" : "credit",
							assetId,
						},
						{ assetId, assetCode: "USD", minorUnitExponent: 2 }
					)
				)
			);

			// Each regular account pairs with a hot account (round-robin)
			const hotPairIndex = i % hotAccounts.length;
			const hotPair = hotAccounts[hotPairIndex];

			// Alternate: regular debits to hot credit, or regular credits from hot debit
			if (i % 2 === 0) {
				accountPairs.push({
					debitId: regularAccount.id.toString(),
					creditId: hotPair.creditId,
				});
			} else {
				accountPairs.push({
					debitId: hotPair.debitId,
					creditId: regularAccount.id.toString(),
				});
			}
		}
	} else {
		// Regular pattern: Create account pairs (each pair = 1 debit + 1 credit account)
		const pairCount = accountCount / 2;

		for (let i = 0; i < pairCount; i++) {
			const debitAccount = await Effect.runPromise(
				accountRepo.createAccount(
					LedgerAccount.fromCreateRequest(
						newLedgerAccountID(),
						orgId,
						ledger.id,
						{
							name: `Debit Account ${i}`,
							description: `Debit account for pair ${i}`,
							normalBalance: "debit",
							assetId,
						},
						{ assetId, assetCode: "USD", minorUnitExponent: 2 }
					)
				)
			);

			const creditAccount = await Effect.runPromise(
				accountRepo.createAccount(
					LedgerAccount.fromCreateRequest(
						newLedgerAccountID(),
						orgId,
						ledger.id,
						{
							name: `Credit Account ${i}`,
							description: `Credit account for pair ${i}`,
							normalBalance: "credit",
							assetId,
						},
						{ assetId, assetCode: "USD", minorUnitExponent: 2 }
					)
				)
			);

			accountPairs.push({
				debitId: debitAccount.id.toString(),
				creditId: creditAccount.id.toString(),
			});
		}
	}

	return {
		ledgerId: ledger.id,
		accountPairs,
	};
}

async function cleanupFixtures(db: DrizzleDatabase, orgId: OrgID): Promise<void> {
	// Retry cleanup to handle transient failures from straggler connections
	await retry(
		{
			times: 3,
			delay: 1000,
			backoff: attempt => {
				// Exponential backoff: 1s, 2s, 4s
				return 1000 * 2 ** attempt;
			},
		},
		async () => {
			try {
				// Delete in dependency order within a single transaction
				// This ensures atomicity even if there are straggler connections from the server
				const orgIdStr = orgId.toUUID();

				await db.transaction(async tx => {
					// 1. Delete all settlements and settlement entries
					await tx.execute(sql`
						DELETE FROM ledger_account_settlement_entries
						WHERE settlement_id IN (
							SELECT id FROM ledger_account_settlements
							WHERE organization_id = ${orgIdStr}
						)
					`);

					await tx.execute(sql`
						DELETE FROM ledger_account_settlements
						WHERE organization_id = ${orgIdStr}
					`);

					// 2. Delete all transaction entries and transactions
					await tx.execute(sql`
						DELETE FROM ledger_transaction_entries
						WHERE organization_id = ${orgIdStr}
					`);

					await tx.execute(sql`
						DELETE FROM ledger_transactions
						WHERE organization_id = ${orgIdStr}
					`);

					// 3. Delete all accounts
					await tx.execute(sql`
						DELETE FROM ledger_accounts
						WHERE organization_id = ${orgIdStr}
					`);

					// 4. Delete all ledgers
					await tx.execute(sql`
						DELETE FROM ledgers
						WHERE organization_id = ${orgIdStr}
					`);

					// 5. Delete organization-owned Assets after their Accounts
					await tx.execute(sql`
						DELETE FROM assets
						WHERE organization_id = ${orgIdStr}
					`);

					// 6. Delete the organization
					await tx.execute(sql`
						DELETE FROM organizations_table
						WHERE id = ${orgIdStr}
					`);
				});
			} catch (error) {
				console.error("Cleanup attempt failed:", error);
				throw error; // Let retry handle it
			}
		}
	);
}

function createTransactionPayload(accountPair: { debitId: string; creditId: string }) {
	return {
		description: "Benchmark transaction",
		status: "pending",
		ledgerEntries: [
			{
				accountId: accountPair.debitId,
				direction: "debit",
				amount: "10000",
				assetCode: "USD",
			},
			{
				accountId: accountPair.creditId,
				direction: "credit",
				amount: "10000",
				assetCode: "USD",
			},
		],
	};
}

async function runBenchmark(
	scenario: BenchmarkScenario,
	ledgerId: string,
	token: string
): Promise<BenchmarkResult> {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`Running scenario: ${scenario.name}`);
	console.log(`Account pairs: ${scenario.accountCount / 2}`);
	console.log(`${"=".repeat(60)}\n`);

	// Pre-generate some request bodies to cycle through
	const requestBodies = Array.from({ length: 100 }, () => {
		const pairIndex = Math.floor(Math.random() * scenario.accountPairs.length);
		const accountPair = scenario.accountPairs[pairIndex];
		return JSON.stringify(createTransactionPayload(accountPair));
	});

	const result = await autocannon({
		url: `http://localhost:3333/api/ledgers/${ledgerId}/transactions`,
		connections: 100,
		duration: 30,
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"Idempotency-Key": randomUUID(),
		},
		body: requestBodies[0], // Use first body as template
		requests: requestBodies.map(body => ({
			method: "POST",
			path: `/api/ledgers/${ledgerId}/transactions`,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body,
			setupRequest: request => {
				request.headers = { ...request.headers, "Idempotency-Key": randomUUID() };
				return request;
			},
		})),
	});

	expect(result["2xx"]).toBeGreaterThan(0);
	return {
		scenario: scenario.name,
		accountCount: scenario.accountCount,
		requests: result.requests.total,
		duration: result.duration,
		throughput: result.requests.average,
		latency: {
			p50: result.latency.p50,
			p97_5: result.latency.p97_5,
			p99: result.latency.p99,
			mean: result.latency.mean,
		},
		errors: result.errors,
	};
}

function printResults(results: BenchmarkResult[]): void {
	console.log("\n" + "=".repeat(80));
	console.log("BENCHMARK RESULTS SUMMARY");
	console.log("=".repeat(80) + "\n");

	console.log(
		"Scenario".padEnd(25),
		"Accounts".padEnd(10),
		"Req/sec".padEnd(10),
		"p50".padEnd(8),
		"p97.5".padEnd(8),
		"p99".padEnd(8),
		"Errors"
	);
	console.log("-".repeat(80));

	for (const result of results) {
		console.log(
			result.scenario.padEnd(25),
			result.accountCount.toString().padEnd(10),
			result.throughput.toFixed(2).padEnd(10),
			`${result.latency.p50}ms`.padEnd(8),
			`${result.latency.p97_5}ms`.padEnd(8),
			`${result.latency.p99}ms`.padEnd(8),
			result.errors.toString()
		);
	}

	console.log("\n" + "=".repeat(80));
	console.log("ANALYSIS");
	console.log("=".repeat(80) + "\n");

	const highContention = results[0];
	const lowContention = results[results.length - 1];

	const throughputDegradation =
		((lowContention.throughput - highContention.throughput) / lowContention.throughput) * 100;
	const latencyIncrease =
		((highContention.latency.p97_5 - lowContention.latency.p97_5) / lowContention.latency.p97_5) *
		100;

	console.log(
		`Throughput degradation (high vs low contention): ${throughputDegradation.toFixed(2)}%`
	);
	console.log(`P97.5 latency increase (high vs low contention): ${latencyIncrease.toFixed(2)}%`);
	console.log(`\nHigh contention throughput: ${highContention.throughput.toFixed(2)} req/sec`);
	console.log(`Low contention throughput: ${lowContention.throughput.toFixed(2)} req/sec`);
	console.log("\n");
}

describe("Transaction Creation Benchmarks", () => {
	let server: FastifyInstance;
	const fixtureRuntime = ManagedRuntime.make(
		Layer.mergeAll(ledgerRepoLayer, ledgerAccountRepoLayer).pipe(
			Layer.provideMerge(
				makeDatabaseLive(
					new Config().databaseUrl,
					connectionString => new Pool({ connectionString, max: 20 })
				)
			)
		)
	);
	let db: DrizzleDatabase;
	let ledgerRepo: LedgerRepo;
	let accountRepo: LedgerAccountRepo;
	let sharedOrgId: OrgID;
	let sharedAssetId: string;
	const results: BenchmarkResult[] = [];

	beforeAll(async () => {
		db = (await fixtureRuntime.runPromise(DatabaseTag)).db;

		ledgerRepo = await fixtureRuntime.runPromise(LedgerRepoTag);
		accountRepo = await fixtureRuntime.runPromise(LedgerAccountRepoTag);

		// Create shared organization for all tests
		console.log("Creating shared organization...");
		sharedOrgId = new TypeID("org");
		await db.insert(OrganizationsTable).values({
			id: sharedOrgId.toUUID(),
			name: "Benchmark Organization",
			description: "Shared organization for all benchmark tests",
		});
		sharedAssetId = new TypeID("ast").toString();
		await db.insert(AssetsTable).values({
			id: TypeID.fromString(sharedAssetId).toUUID(),
			organizationId: sharedOrgId.toUUID(),
			code: "USD",
			name: "US Dollar",
			minorUnitExponent: 2,
		});
		console.log(`Shared organization created: ${sharedOrgId.toString()}\n`);

		// Start server
		console.log("Starting server...");
		server = await buildServer();
		await server.listen({ port: 3333, host: "0.0.0.0" });
		console.log("Server started on http://localhost:3333\n");
	});

	afterAll(async () => {
		// Close server first - this will trigger onClose hooks and clean up its connection pool
		if (server) {
			console.log("\nClosing server...");
			await server.close();
			console.log("Server closed");
		}

		// Cleanup all fixtures using our test repos
		console.log("Cleaning up all fixtures...");
		await cleanupFixtures(db, sharedOrgId);
		console.log("Cleanup complete\n");

		// Close the fixture runtime and its database pools
		await fixtureRuntime.dispose();

		// Print summary of all results
		if (results.length > 0) {
			printResults(results);
		}
	});

	it("should benchmark high contention (2 accounts)", async () => {
		console.log("\nSetting up fixtures for High Contention...");
		const { ledgerId, accountPairs } = await setupFixtures(
			ledgerRepo,
			accountRepo,
			sharedOrgId,
			sharedAssetId,
			2
		);

		const token = signJWT({ sub: sharedOrgId.toString(), scope: ["org_admin"] });
		const scenario: BenchmarkScenario = {
			name: "High Contention",
			accountCount: 2,
			accountPairs,
		};

		const result = await runBenchmark(scenario, ledgerId.toString(), token);
		results.push(result);

		// Basic assertions
		expect(result.throughput).toBeGreaterThan(0);
		expect(result.errors).toBe(0);
	});

	it("should benchmark medium contention (20 accounts)", async () => {
		console.log("\nSetting up fixtures for Medium Contention...");
		const { ledgerId, accountPairs } = await setupFixtures(
			ledgerRepo,
			accountRepo,
			sharedOrgId,
			sharedAssetId,
			20
		);

		const token = signJWT({ sub: sharedOrgId.toString(), scope: ["org_admin"] });
		const scenario: BenchmarkScenario = {
			name: "Medium Contention",
			accountCount: 20,
			accountPairs,
		};

		const result = await runBenchmark(scenario, ledgerId.toString(), token);
		results.push(result);

		// Basic assertions
		expect(result.throughput).toBeGreaterThan(0);
		expect(result.errors).toBe(0);
	});

	it("should benchmark low contention (200 accounts)", async () => {
		console.log("\nSetting up fixtures for Low Contention...");
		const { ledgerId, accountPairs } = await setupFixtures(
			ledgerRepo,
			accountRepo,
			sharedOrgId,
			sharedAssetId,
			200
		);

		const token = signJWT({ sub: sharedOrgId.toString(), scope: ["org_admin"] });
		const scenario: BenchmarkScenario = {
			name: "Low Contention",
			accountCount: 200,
			accountPairs,
		};

		const result = await runBenchmark(scenario, ledgerId.toString(), token);
		results.push(result);

		// Basic assertions
		expect(result.throughput).toBeGreaterThan(0);
		expect(result.errors).toBe(0);
	});

	it("should benchmark hot accounts (2 hot + 2000 regular = 2002 accounts)", async () => {
		console.log("\nSetting up fixtures for Hot Accounts (2 hot + 2000 regular)...");
		const { ledgerId, accountPairs } = await setupFixtures(
			ledgerRepo,
			accountRepo,
			sharedOrgId,
			sharedAssetId,
			2002,
			2 // 2 hot accounts
		);

		const token = signJWT({ sub: sharedOrgId.toString(), scope: ["org_admin"] });
		const scenario: BenchmarkScenario = {
			name: "Hot: 2/2002",
			accountCount: 2002,
			accountPairs,
		};

		const result = await runBenchmark(scenario, ledgerId.toString(), token);
		results.push(result);

		// Basic assertions
		expect(result.throughput).toBeGreaterThan(0);
		expect(result.errors).toBe(0);
	});

	it("should benchmark hot accounts (20 hot + 2000 regular = 2020 accounts)", async () => {
		console.log("\nSetting up fixtures for Hot Accounts (20 hot + 2000 regular)...");
		const { ledgerId, accountPairs } = await setupFixtures(
			ledgerRepo,
			accountRepo,
			sharedOrgId,
			sharedAssetId,
			2020,
			20 // 20 hot accounts
		);

		const token = signJWT({ sub: sharedOrgId.toString(), scope: ["org_admin"] });
		const scenario: BenchmarkScenario = {
			name: "Hot: 20/2020",
			accountCount: 2020,
			accountPairs,
		};

		const result = await runBenchmark(scenario, ledgerId.toString(), token);
		results.push(result);

		// Basic assertions
		expect(result.throughput).toBeGreaterThan(0);
		expect(result.errors).toBe(0);
	});
});
