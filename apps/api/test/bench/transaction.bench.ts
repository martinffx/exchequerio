import autocannon from "autocannon";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TypeID } from "typeid-js";
import { signJWT } from "@/auth";
import { Config } from "@/config";
import {
	LedgerAccountEntity,
	LedgerEntity,
	OrganizationEntity,
	type LedgerID,
	type OrgID,
} from "@/repo/entities";
import { LedgerAccountRepo } from "@/repo/LedgerAccountRepo";
import { LedgerRepo } from "@/repo/LedgerRepo";
import { LedgerTransactionRepo } from "@/repo/LedgerTransactionRepo";
import { OrganizationRepo } from "@/repo/OrganizationRepo";
import * as schema from "@/repo/schema";
import {
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	LedgersTable,
	OrganizationsTable,
	LedgerAccountSettlementsTable,
	LedgerAccountSettlementEntriesTable,
} from "@/repo/schema";
import { buildServer } from "@/server";
import type { DrizzleDB } from "@/repo/types";

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
	orgRepo: OrganizationRepo,
	ledgerRepo: LedgerRepo,
	accountRepo: LedgerAccountRepo,
	orgId: OrgID,
	accountCount: number,
	hotAccountCount: number = 0
): Promise<{
	ledgerId: LedgerID;
	accountPairs: Array<{ debitId: string; creditId: string }>;
}> {
	// Create ledger
	const ledger = await ledgerRepo.upsertLedger(
		LedgerEntity.fromRequest(
			{
				name: "Benchmark Ledger",
				description: "Ledger for benchmarking",
				currency: "USD",
				currencyExponent: 2,
			},
			orgId
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
			const hotDebit = await accountRepo.upsertLedgerAccount(
				LedgerAccountEntity.fromRequest(
					{
						name: `Hot Debit Account ${i}`,
						description: `Hot debit account ${i} (high contention)`,
					},
					orgId,
					ledger.id,
					"debit"
				)
			);

			const hotCredit = await accountRepo.upsertLedgerAccount(
				LedgerAccountEntity.fromRequest(
					{
						name: `Hot Credit Account ${i}`,
						description: `Hot credit account ${i} (high contention)`,
					},
					orgId,
					ledger.id,
					"credit"
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
			const regularAccount = await accountRepo.upsertLedgerAccount(
				LedgerAccountEntity.fromRequest(
					{
						name: `Regular Account ${i}`,
						description: `Regular account ${i}`,
					},
					orgId,
					ledger.id,
					i % 2 === 0 ? "debit" : "credit"
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
			const debitAccount = await accountRepo.upsertLedgerAccount(
				LedgerAccountEntity.fromRequest(
					{
						name: `Debit Account ${i}`,
						description: `Debit account for pair ${i}`,
					},
					orgId,
					ledger.id,
					"debit"
				)
			);

			const creditAccount = await accountRepo.upsertLedgerAccount(
				LedgerAccountEntity.fromRequest(
					{
						name: `Credit Account ${i}`,
						description: `Credit account for pair ${i}`,
					},
					orgId,
					ledger.id,
					"credit"
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

async function cleanupFixtures(
	db: DrizzleDB,
	orgId: OrgID
): Promise<void> {
	// Delete in dependency order using raw SQL for reliability
	// Order: settlement entries -> settlements -> transaction entries -> transactions -> accounts -> ledgers -> organization

	const orgIdStr = orgId.toString();

	// 1. Delete all settlement entries for this org's settlements
	await db.execute(sql`
		DELETE FROM ledger_account_settlement_entries
		WHERE settlement_id IN (
			SELECT id FROM ledger_account_settlements
			WHERE organization_id = ${orgIdStr}
		)
	`);

	// 2. Delete all settlements
	await db.execute(sql`
		DELETE FROM ledger_account_settlements
		WHERE organization_id = ${orgIdStr}
	`);

	// 3. Delete all transaction entries (FIRST PASS - using entry's own organization_id)
	const deleteEntriesResult1 = await db.execute(sql`
		DELETE FROM ledger_transaction_entries
		WHERE organization_id = ${orgIdStr}
	`);
	console.log(`[Pass 1] Deleted ${deleteEntriesResult1.rowCount ?? 0} transaction entries`);

	// 4. Delete all transactions (FIRST PASS)
	const deleteTxResult1 = await db.execute(sql`
		DELETE FROM ledger_transactions
		WHERE organization_id = ${orgIdStr}
	`);
	console.log(`[Pass 1] Deleted ${deleteTxResult1.rowCount ?? 0} transactions`);

	// 5. Delete transaction entries again (SECOND PASS - catch stragglers)
	const deleteEntriesResult2 = await db.execute(sql`
		DELETE FROM ledger_transaction_entries
		WHERE organization_id = ${orgIdStr}
	`);
	if ((deleteEntriesResult2.rowCount ?? 0) > 0) {
		console.log(`[Pass 2] Deleted ${deleteEntriesResult2.rowCount ?? 0} remaining transaction entries`);
	}

	// 6. Delete transactions again (SECOND PASS - catch stragglers)
	const deleteTxResult2 = await db.execute(sql`
		DELETE FROM ledger_transactions
		WHERE organization_id = ${orgIdStr}
	`);
	if ((deleteTxResult2.rowCount ?? 0) > 0) {
		console.log(`[Pass 2] Deleted ${deleteTxResult2.rowCount ?? 0} remaining transactions`);
	}

	// 7. Delete all accounts
	await db.execute(sql`
		DELETE FROM ledger_accounts
		WHERE organization_id = ${orgIdStr}
	`);

	// 8. Delete all ledgers
	await db.execute(sql`
		DELETE FROM ledgers
		WHERE organization_id = ${orgIdStr}
	`);

	// 9. Delete the organization
	await db.execute(sql`
		DELETE FROM organizations_table
		WHERE id = ${orgIdStr}
	`);
}

function createTransactionPayload(accountPair: { debitId: string; creditId: string }) {
	return {
		description: "Benchmark transaction",
		status: "pending",
		ledgerEntries: [
			{
				id: new TypeID("lte").toString(),
				accountId: accountPair.debitId,
				direction: "debit",
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "pending",
			},
			{
				id: new TypeID("lte").toString(),
				accountId: accountPair.creditId,
				direction: "credit",
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "pending",
			},
		],
		created: new Date().toISOString(),
		updated: new Date().toISOString(),
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

	let requestIndex = 0;

	const result = await autocannon({
		url: `http://localhost:3000/api/ledgers/${ledgerId}/transactions`,
		connections: 100,
		duration: 30,
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		setupClient: (client) => {
			client.on("response", () => {
				requestIndex++;
			});
		},
		body: requestBodies[0], // Use first body as template
		requests: requestBodies.map((body) => ({
			method: "POST",
			path: `/api/ledgers/${ledgerId}/transactions`,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body,
		})),
	});

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
		((highContention.latency.p97_5 - lowContention.latency.p97_5) / lowContention.latency.p97_5) * 100;

	console.log(`Throughput degradation (high vs low contention): ${throughputDegradation.toFixed(2)}%`);
	console.log(`P97.5 latency increase (high vs low contention): ${latencyIncrease.toFixed(2)}%`);
	console.log(`\nHigh contention throughput: ${highContention.throughput.toFixed(2)} req/sec`);
	console.log(`Low contention throughput: ${lowContention.throughput.toFixed(2)} req/sec`);
	console.log("\n");
}

describe("Transaction Creation Benchmarks", () => {
	let server: FastifyInstance;
	let pool: Pool;
	let db: DrizzleDB;
	let orgRepo: OrganizationRepo;
	let ledgerRepo: LedgerRepo;
	let accountRepo: LedgerAccountRepo;
	let transactionRepo: LedgerTransactionRepo;
	let sharedOrgId: OrgID;
	const results: BenchmarkResult[] = [];

	beforeAll(async () => {
		const config = new Config();
		pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
		db = drizzle(pool, { schema });

		orgRepo = new OrganizationRepo(db);
		ledgerRepo = new LedgerRepo(db);
		accountRepo = new LedgerAccountRepo(db);
		transactionRepo = new LedgerTransactionRepo(db);

		// Create shared organization for all tests
		console.log("Creating shared organization...");
		const org = await orgRepo.createOrganization(
			OrganizationEntity.fromRequest({
				name: "Benchmark Organization",
				description: "Shared organization for all benchmark tests",
			})
		);
		sharedOrgId = org.id;
		console.log(`Shared organization created: ${sharedOrgId.toString()}\n`);

		// Start server
		console.log("Starting server...");
		server = await buildServer();
		await server.listen({ port: 3000, host: "0.0.0.0" });
		console.log("Server started on http://localhost:3000\n");
	});

	afterAll(async () => {
		// Print summary of all results
		if (results.length > 0) {
			printResults(results);
		}
  	// Close server first to stop accepting new requests
  	if (server) {
  		await server.close();
  	}

  	// Wait for in-flight database transactions to complete
  	console.log("\nWaiting for in-flight transactions to complete...");
  	await new Promise(resolve => setTimeout(resolve, 1000));

  	// Cleanup all fixtures
  	console.log("Cleaning up all fixtures...");
  	await cleanupFixtures(db, sharedOrgId);
  	console.log("Cleanup complete\n");

		await pool.end();
	});

	it("should benchmark high contention (2 accounts)", async () => {
		console.log("\nSetting up fixtures for High Contention...");
		const { ledgerId, accountPairs } = await setupFixtures(
			orgRepo,
			ledgerRepo,
			accountRepo,
			sharedOrgId,
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
			orgRepo,
			ledgerRepo,
			accountRepo,
			sharedOrgId,
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
			orgRepo,
			ledgerRepo,
			accountRepo,
			sharedOrgId,
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
			orgRepo,
			ledgerRepo,
			accountRepo,
			sharedOrgId,
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
			orgRepo,
			ledgerRepo,
			accountRepo,
			sharedOrgId,
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
