import { eq, inArray, sql } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { type Database, type EffectDrizzleDatabase, DatabaseTag, makeDatabaseLive } from "@/db";
import { LedgerRepoTag, ledgerRepoLayer, type LedgerRepo } from "../../LedgerRepo";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import type { LedgerAccountID, LedgerAccountStatementID, LedgerID, OrgID } from "@/lib/ids";
import {
	AssetsTable,
	LedgerAccountsTable,
	LedgerAccountStatementsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/db/schema";
import {
	type LedgerAccountStatementRepo,
	LedgerAccountStatementRepoLive,
	LedgerAccountStatementRepoTag,
	ledgerAccountStatementRepoLayer,
} from "./LedgerAccountStatementRepo";
import {
	mapStatementInfrastructureError,
	StatementPersistenceDecodingFailure,
	StatementPersistenceFailure,
	StatementRepositoryUnavailable,
} from "./StatementErrors";

const parsed = (request: { startDatetime: string; endDatetime: string }) => ({
	startDatetime: new Date(request.startDatetime),
	endDatetime: new Date(request.endDatetime),
});
const lteId = (uuid: string) => TypeID.fromUUID("lte", uuid).toString();

describe("LedgerAccountStatementRepoLive", () => {
	const organizationId = new TypeID("org") as OrgID;
	const ledgerId = new TypeID("lgr") as LedgerID;
	const accountId = new TypeID("lat") as LedgerAccountID;
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			databaseLayer,
			ledgerAccountStatementRepoLayer.pipe(Layer.provide(databaseLayer)),
			ledgerRepoLayer.pipe(Layer.provide(databaseLayer))
		)
	);
	let repository: LedgerAccountStatementRepo;
	let ledgers: LedgerRepo;
	let db: Database["db"];
	const assetId = new TypeID("ast");
	const scope = [organizationId, ledgerId, accountId] as const;
	const period = {
		startDatetime: "2025-01-01T00:00:00.000Z",
		endDatetime: "2025-02-01T00:00:00.000Z",
	};
	const page = { offset: 0, limit: 100 };
	const create = (request = period) =>
		runtime.runPromise(
			repository.createStatement(
				...scope,
				new TypeID("lst") as LedgerAccountStatementID,
				request,
				parsed(request)
			)
		);
	const addEntry = async (
		effectiveAt: string,
		status: "posted" | "pending" | "voided",
		direction: "debit" | "credit",
		amount: bigint
	) => {
		const transactionId = new TypeID("ltr").toUUID();
		const id = new TypeID("lte").toUUID();
		await db.insert(LedgerTransactionsTable).values({
			id: transactionId,
			organizationId: organizationId.toUUID(),
			ledgerId: ledgerId.toUUID(),
			status,
			effectiveAt: new Date(effectiveAt),
		});
		await db.insert(LedgerTransactionEntriesTable).values({
			id,
			transactionId,
			organizationId: organizationId.toUUID(),
			ledgerId: ledgerId.toUUID(),
			accountId: accountId.toUUID(),
			direction,
			amount,
			assetId: assetId.toUUID(),
			status,
		});
		return { id, transactionId };
	};
	beforeAll(async () => {
		repository = await runtime.runPromise(LedgerAccountStatementRepoTag);
		ledgers = await runtime.runPromise(LedgerRepoTag);
		db = (await runtime.runPromise(DatabaseTag)).db;
		await db
			.insert(OrganizationsTable)
			.values({ id: organizationId.toUUID(), name: "Statement repository organization" });
		await db.insert(AssetsTable).values({
			id: assetId.toUUID(),
			organizationId: organizationId.toUUID(),
			code: "USD",
			name: "US Dollar",
			minorUnitExponent: 2,
		});
		await db.insert(LedgersTable).values({
			id: ledgerId.toUUID(),
			organizationId: organizationId.toUUID(),
			name: "Statement repository ledger",
		});
		await db.insert(LedgerAccountsTable).values({
			id: accountId.toUUID(),
			organizationId: organizationId.toUUID(),
			ledgerId: ledgerId.toUUID(),
			name: "Statement repository account",
			normalBalance: "debit",
			assetId: assetId.toUUID(),
		});
	});
	afterAll(async () => {
		try {
			await db
				.delete(LedgerAccountStatementsTable)
				.where(eq(LedgerAccountStatementsTable.ledgerId, ledgerId.toUUID()));
			await db
				.delete(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.ledgerId, ledgerId.toUUID()));
			await db
				.delete(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.ledgerId, ledgerId.toUUID()));
			await db.delete(LedgerAccountsTable).where(eq(LedgerAccountsTable.id, accountId.toUUID()));
			await db.delete(LedgersTable).where(eq(LedgersTable.id, ledgerId.toUUID()));
			await db.delete(AssetsTable).where(eq(AssetsTable.id, assetId.toUUID()));
			await db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, organizationId.toUUID()));
		} finally {
			await runtime.dispose();
		}
	});
	it("saves empty future periods and never embeds entries in summaries", async () => {
		const statement = await create({
			startDatetime: "2100-01-01T00:00:00.000Z",
			endDatetime: "2100-02-01T00:00:00.000Z",
		});
		const response = statement.toResponse();
		expect(response.startingBalances).toEqual(response.endingBalances);
		expect(response).not.toHaveProperty("entries");
		expect(await runtime.runPromise(repository.getEntries(...scope, statement.id, page))).toEqual([]);
	});
	it("captures effective-time boundaries, status, balances and preserves copies after source replacement", async () => {
		await addEntry("2024-12-31T23:59:59.000Z", "posted", "debit", 100n);
		const pending = await addEntry(period.startDatetime, "pending", "credit", 20n);
		const posted = await addEntry("2025-01-15T00:00:00.000Z", "posted", "debit", 30n);
		await addEntry(period.endDatetime, "posted", "debit", 400n);
		await addEntry("2025-01-12T00:00:00.000Z", "voided", "debit", 900n);
		const statement = await create();
		const id = statement.id;
		const entries = await runtime.runPromise(repository.getEntries(...scope, id, page));
		expect(entries.map(entry => entry.id)).toEqual([lteId(pending.id), lteId(posted.id)]);
		expect(statement.toResponse().startingBalances).toEqual(
			expect.arrayContaining([expect.objectContaining({ balanceType: "posted", amount: "100" })])
		);
		expect(statement.toResponse().endingBalances).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ balanceType: "posted", amount: "130" }),
				expect.objectContaining({ balanceType: "pending", amount: "110" }),
			])
		);
		await db
			.delete(LedgerTransactionEntriesTable)
			.where(eq(LedgerTransactionEntriesTable.id, pending.id));
		await db
			.update(LedgerTransactionsTable)
			.set({ status: "voided", lockVersion: 2 })
			.where(eq(LedgerTransactionsTable.id, posted.transactionId));
		expect(await runtime.runPromise(repository.getEntries(...scope, id, page))).toEqual(entries);
		expect((await runtime.runPromise(repository.getStatement(...scope, id))).toResponse()).toEqual(
			statement.toResponse()
		);
		await addEntry("2024-12-30T00:00:00.000Z", "posted", "credit", 2n);
		expect((await runtime.runPromise(repository.getStatement(...scope, id))).toResponse()).toEqual(
			statement.toResponse()
		);
		const regenerated = await create();
		expect(regenerated.id).not.toBe(statement.id);
		expect(regenerated.toResponse().endingBalances).not.toEqual(
			statement.toResponse().endingBalances
		);
	});
	it("scopes reads, lists and annotation writes and atomically rejects one concurrent stale writer", async () => {
		const statement = await create();
		const id = statement.id;
		const wrongOrg = new TypeID("org") as OrgID;
		for (const operation of [
			repository.getStatement(wrongOrg, ledgerId, accountId, id),
			repository.getStatement(organizationId, new TypeID("lgr") as LedgerID, accountId, id),
			repository.getStatement(organizationId, ledgerId, new TypeID("lat") as LedgerAccountID, id),
			repository.createStatement(
				wrongOrg,
				ledgerId,
				accountId,
				new TypeID("lst") as LedgerAccountStatementID,
				period,
				parsed(period)
			),
			repository.getEntries(wrongOrg, ledgerId, accountId, id, page),
			repository.listStatements(wrongOrg, ledgerId, accountId, page),
			repository.updateAnnotations(wrongOrg, ledgerId, accountId, id, { lockVersion: 1 }),
		]) {
			expect(
				await runtime.runPromise(Effect.flip(operation as Effect.Effect<unknown, unknown>))
			).toBeInstanceOf(NotFoundError);
		}
		const results = await Promise.all(
			["first", "second"].map(description =>
				runtime.runPromise(
					Effect.result(repository.updateAnnotations(...scope, id, { lockVersion: 1, description }))
				)
			)
		);
		expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
		const failure = results.find(result => result._tag === "Failure");
		expect(failure && failure._tag === "Failure" && failure.failure).toBeInstanceOf(ConflictError);
		const cleared = await runtime.runPromise(
			repository.updateAnnotations(...scope, id, { lockVersion: 2 })
		);
		expect(cleared.toResponse().description).toBeUndefined();
		expect(cleared.toResponse().lockVersion).toBe(3);
		expect(cleared.toResponse().startingBalances).toEqual(statement.toResponse().startingBalances);
		expect(cleared.toResponse().endingBalances).toEqual(statement.toResponse().endingBalances);
	});
	it("returns Entries with TypeID-form ids", async () => {
		const entry = await addEntry("2031-01-15T00:00:00.000Z", "posted", "debit", 7n);
		const statement = await create({
			startDatetime: "2031-01-01T00:00:00.000Z",
			endDatetime: "2031-02-01T00:00:00.000Z",
		});
		const [saved] = await runtime.runPromise(repository.getEntries(...scope, statement.id, page));
		expect(saved?.id).toBe(lteId(entry.id));
		expect(saved?.accountId).toBe(accountId.toString());
		expect(saved?.assetId).toBe(assetId.toString());
		expect(saved?.transaction.id).toBe(TypeID.fromUUID("ltr", entry.transactionId).toString());
	});
	it("returns a typed decoding failure for a stored infinite timestamp", async () => {
		const statement = await create();
		await db
			.update(LedgerAccountStatementsTable)
			.set({ created: sql`'infinity'::timestamptz` })
			.where(eq(LedgerAccountStatementsTable.id, statement.id.toUUID()));
		try {
			const error = await runtime.runPromise(
				Effect.flip(repository.getStatement(...scope, statement.id))
			);
			expect(error).toBeInstanceOf(StatementPersistenceDecodingFailure);
		} finally {
			await db
				.delete(LedgerAccountStatementsTable)
				.where(eq(LedgerAccountStatementsTable.id, statement.id.toUUID()));
		}
	});
	it("fails listing with a typed decoding failure when one stored row is corrupt", async () => {
		const valid = await create();
		const corrupt = await create();
		await db
			.update(LedgerAccountStatementsTable)
			.set({ created: sql`'infinity'::timestamptz` })
			.where(eq(LedgerAccountStatementsTable.id, corrupt.id.toUUID()));
		try {
			const error = await runtime.runPromise(Effect.flip(repository.listStatements(...scope, page)));
			expect(error).toBeInstanceOf(StatementPersistenceDecodingFailure);
		} finally {
			await db
				.delete(LedgerAccountStatementsTable)
				.where(inArray(LedgerAccountStatementsTable.id, [valid.id.toUUID(), corrupt.id.toUUID()]));
		}
	});
	it("fails reading Entries with a typed decoding failure when a stored Entry is corrupt", async () => {
		await addEntry("2032-01-15T00:00:00.000Z", "posted", "debit", 5n);
		const statement = await create({
			startDatetime: "2032-01-01T00:00:00.000Z",
			endDatetime: "2032-02-01T00:00:00.000Z",
		});
		await db
			.update(LedgerAccountStatementsTable)
			.set({
				snapshot: sql`jsonb_set(${LedgerAccountStatementsTable.snapshot}, '{entries,0,id}', '123'::jsonb)`,
			})
			.where(eq(LedgerAccountStatementsTable.id, statement.id.toUUID()));
		try {
			const error = await runtime.runPromise(
				Effect.flip(repository.getEntries(...scope, statement.id, page))
			);
			expect(error).toBeInstanceOf(StatementPersistenceDecodingFailure);
		} finally {
			await db
				.delete(LedgerAccountStatementsTable)
				.where(eq(LedgerAccountStatementsTable.id, statement.id.toUUID()));
		}
	});
	it("deletes one Statement so fixture cleanup can remove its Ledger", async () => {
		const fixtureOrg = new TypeID("org") as OrgID;
		const fixtureLedger = new TypeID("lgr") as LedgerID;
		const fixtureAccount = new TypeID("lat") as LedgerAccountID;
		const fixtureAsset = new TypeID("ast");
		await db.insert(OrganizationsTable).values({ id: fixtureOrg.toUUID(), name: "Fixture cleanup" });
		try {
			await db.insert(AssetsTable).values({
				id: fixtureAsset.toUUID(),
				organizationId: fixtureOrg.toUUID(),
				code: "EUR",
				name: "Euro",
				minorUnitExponent: 2,
			});
			await db.insert(LedgersTable).values({
				id: fixtureLedger.toUUID(),
				organizationId: fixtureOrg.toUUID(),
				name: "Fixture cleanup ledger",
			});
			await db.insert(LedgerAccountsTable).values({
				id: fixtureAccount.toUUID(),
				organizationId: fixtureOrg.toUUID(),
				ledgerId: fixtureLedger.toUUID(),
				name: "Fixture cleanup account",
				normalBalance: "debit",
				assetId: fixtureAsset.toUUID(),
			});
			const created = await runtime.runPromise(
				repository.createStatement(
					fixtureOrg,
					fixtureLedger,
					fixtureAccount,
					new TypeID("lst") as LedgerAccountStatementID,
					period,
					parsed(period)
				)
			);
			await runtime.runPromise(
				repository.deleteStatement(fixtureOrg, fixtureLedger, fixtureAccount, created.id)
			);
			expect(
				await runtime.runPromise(
					Effect.flip(repository.deleteStatement(fixtureOrg, fixtureLedger, fixtureAccount, created.id))
				)
			).toBeInstanceOf(NotFoundError);
			await runtime.runPromise(ledgers.deleteLedgerFixtures(fixtureOrg, fixtureLedger));
			expect(
				await db
					.select({ id: LedgerAccountStatementsTable.id })
					.from(LedgerAccountStatementsTable)
					.where(eq(LedgerAccountStatementsTable.ledgerId, fixtureLedger.toUUID()))
			).toHaveLength(0);
			expect(
				await db
					.select({ id: LedgersTable.id })
					.from(LedgersTable)
					.where(eq(LedgersTable.id, fixtureLedger.toUUID()))
			).toHaveLength(0);
		} finally {
			await db.delete(AssetsTable).where(eq(AssetsTable.id, fixtureAsset.toUUID()));
			await db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, fixtureOrg.toUUID()));
		}
	});
	it("pages saved Entries in effective-time/ID order and lists summaries newest first", async () => {
		const request = {
			startDatetime: "2030-01-01T00:00:00.000Z",
			endDatetime: "2030-02-01T00:00:00.000Z",
		};
		const first = await addEntry(request.startDatetime, "posted", "credit", 3n);
		const secondId = new TypeID("lte").toUUID();
		await db.insert(LedgerTransactionEntriesTable).values({
			id: secondId,
			transactionId: first.transactionId,
			organizationId: organizationId.toUUID(),
			ledgerId: ledgerId.toUUID(),
			accountId: accountId.toUUID(),
			direction: "debit",
			amount: 5n,
			assetId: assetId.toUUID(),
			status: "posted",
		});
		const statement = await create(request);
		const id = statement.id;
		const all = await runtime.runPromise(repository.getEntries(...scope, id, page));
		expect(all.map(entry => entry.id)).toEqual([lteId(first.id), lteId(secondId)].sort());
		expect(
			await runtime.runPromise(repository.getEntries(...scope, id, { offset: 1, limit: 1 }))
		).toEqual(all.slice(1));
		const list = await runtime.runPromise(
			repository.listStatements(...scope, { offset: 0, limit: 1 })
		);
		expect(list.map(item => item.id)).toEqual([statement.id]);
		const allStatements = await runtime.runPromise(repository.listStatements(...scope, page));
		expect(
			await runtime.runPromise(repository.listStatements(...scope, { offset: 1, limit: 1 }))
		).toEqual(allStatements.slice(1, 2));
	});
	it("accepts 10,000 Entries and rejects 10,001 without a partial snapshot", async () => {
		const request = {
			startDatetime: "2040-01-01T00:00:00.000Z",
			endDatetime: "2040-02-01T00:00:00.000Z",
		};
		const entry = await addEntry(request.startDatetime, "posted", "debit", 1n);
		await db.execute(
			sql`INSERT INTO ledger_transaction_entries (id, transaction_id, account_id, organization_id, ledger_id, direction, amount, asset_id, status) SELECT gen_random_uuid(), ${entry.transactionId}::uuid, ${accountId.toUUID()}::uuid, ${organizationId.toUUID()}::uuid, ${ledgerId.toUUID()}::uuid, 'debit', 1, ${assetId.toUUID()}::uuid, 'posted' FROM generate_series(1, 9999) n`
		);
		const saved = await create(request);
		expect(
			await runtime.runPromise(
				repository.getEntries(...scope, saved.id, {
					offset: 9999,
					limit: 1,
				})
			)
		).toHaveLength(1);
		await addEntry(request.startDatetime, "posted", "debit", 1n);
		const id = new TypeID("lst") as LedgerAccountStatementID;
		expect(
			await runtime.runPromise(
				Effect.flip(repository.createStatement(...scope, id, request, parsed(request)))
			)
		).toBeInstanceOf(BadRequestError);
		expect(
			await runtime.runPromise(Effect.flip(repository.getStatement(...scope, id)))
		).toBeInstanceOf(NotFoundError);
	}, 15000);
	it("bounds the preflight to 10,001 Entries for oversized periods", async () => {
		const request = {
			startDatetime: "2045-01-01T00:00:00.000Z",
			endDatetime: "2045-02-01T00:00:00.000Z",
		};
		const entry = await addEntry(request.startDatetime, "posted", "debit", 1n);
		await db.execute(
			sql`INSERT INTO ledger_transaction_entries (id, transaction_id, account_id, organization_id, ledger_id, direction, amount, asset_id, status) SELECT gen_random_uuid(), ${entry.transactionId}::uuid, ${accountId.toUUID()}::uuid, ${organizationId.toUUID()}::uuid, ${ledgerId.toUUID()}::uuid, 'debit', 1, ${assetId.toUUID()}::uuid, 'posted' FROM generate_series(1, 10001) n`
		);
		const effectDb = (await runtime.runPromise(DatabaseTag)).effectDb;
		const queryResults: unknown[] = [];
		const observedDb = new Proxy(effectDb, {
			get(target, property, receiver) {
				if (property !== "transaction") return Reflect.get(target, property, receiver) as unknown;
				return (
					callback: Parameters<EffectDrizzleDatabase["transaction"]>[0],
					config: Parameters<EffectDrizzleDatabase["transaction"]>[1]
				) =>
					target.transaction(
						tx =>
							callback(
								new Proxy(tx, {
									get(transaction, key, transactionReceiver) {
										if (key !== "execute")
											return Reflect.get(transaction, key, transactionReceiver) as unknown;
										return (...args: Parameters<typeof tx.execute>) =>
											tx.execute(...args).pipe(Effect.tap(rows => Effect.sync(() => queryResults.push(rows))));
									},
								})
							),
						config
					);
			},
		});
		const observedRepository = new LedgerAccountStatementRepoLive(observedDb);
		const id = new TypeID("lst") as LedgerAccountStatementID;
		expect(
			await runtime.runPromise(
				Effect.flip(observedRepository.createStatement(...scope, id, request, parsed(request)))
			)
		).toBeInstanceOf(BadRequestError);
		expect(queryResults).toContainEqual([expect.objectContaining({ count: "10001" })]);
		expect(
			await runtime.runPromise(Effect.flip(repository.getStatement(...scope, id)))
		).toBeInstanceOf(NotFoundError);
	});
	it("preflights oversized metadata in SQL and rolls back the rejected snapshot", async () => {
		const request = {
			startDatetime: "2050-01-01T00:00:00.000Z",
			endDatetime: "2050-02-01T00:00:00.000Z",
		};
		const entry = await addEntry(request.startDatetime, "pending", "credit", 1n);
		await db.execute(
			sql`UPDATE ledger_transaction_entries SET metadata = jsonb_build_object('large', repeat('x', 16777216))::text WHERE id = ${entry.id}::uuid`
		);
		const id = new TypeID("lst") as LedgerAccountStatementID;
		expect(
			await runtime.runPromise(
				Effect.flip(repository.createStatement(...scope, id, request, parsed(request)))
			)
		).toBeInstanceOf(BadRequestError);
		expect(
			await runtime.runPromise(Effect.flip(repository.getStatement(...scope, id)))
		).toBeInstanceOf(NotFoundError);
		await db
			.update(LedgerTransactionEntriesTable)
			.set({ metadata: '{"large":""}' })
			.where(eq(LedgerTransactionEntriesTable.id, entry.id));
		const small = await create(request);
		const [size] = await db
			.select({ bytes: sql<number>`octet_length(${LedgerAccountStatementsTable.snapshot}::text)` })
			.from(LedgerAccountStatementsTable)
			.where(eq(LedgerAccountStatementsTable.id, small.id.toUUID()));
		const padding = 16777216 - size!.bytes;
		await db.execute(
			sql`UPDATE ledger_transaction_entries SET metadata = jsonb_build_object('large', repeat('x', ${padding}))::text WHERE id = ${entry.id}::uuid`
		);
		const exact = await create(request);
		const [stored] = await db
			.select({ bytes: sql<number>`octet_length(${LedgerAccountStatementsTable.snapshot}::text)` })
			.from(LedgerAccountStatementsTable)
			.where(eq(LedgerAccountStatementsTable.id, exact.id.toUUID()));
		expect(stored?.bytes).toBe(16777216);
		await db.execute(
			sql`UPDATE ledger_transaction_entries SET metadata = jsonb_build_object('large', repeat('x', ${padding + 1}))::text WHERE id = ${entry.id}::uuid`
		);
		expect(
			await runtime.runPromise(
				Effect.flip(repository.createStatement(...scope, id, request, parsed(request)))
			)
		).toBeInstanceOf(BadRequestError);
	}, 15000);

	it("keeps aggregates and copied Entries on one repeatable-read view while posting commits", async () => {
		const request = {
			startDatetime: "2060-01-01T00:00:00.000Z",
			endDatetime: "2060-02-01T00:00:00.000Z",
		};
		const entry = await addEntry(request.startDatetime, "pending", "credit", 7n);
		const effectDb = (await runtime.runPromise(DatabaseTag)).effectDb;
		let committed = false;
		const observedDb = new Proxy(effectDb, {
			get(target, property, receiver) {
				if (property !== "transaction") return Reflect.get(target, property, receiver) as unknown;
				return (
					callback: Parameters<EffectDrizzleDatabase["transaction"]>[0],
					config: Parameters<EffectDrizzleDatabase["transaction"]>[1]
				) =>
					target.transaction(
						tx =>
							callback(
								new Proxy(tx, {
									get(transaction, key, transactionReceiver) {
										if (key !== "execute")
											return Reflect.get(transaction, key, transactionReceiver) as unknown;
										return (...args: Parameters<typeof tx.execute>) =>
											tx.execute(...args).pipe(
												Effect.tap(() => {
													if (committed) return Effect.void;
													committed = true;
													return Effect.tryPromise(() =>
														db.transaction(async writer => {
															await writer
																.update(LedgerTransactionsTable)
																.set({ status: "posted", lockVersion: 2 })
																.where(eq(LedgerTransactionsTable.id, entry.transactionId));
															await writer
																.update(LedgerTransactionEntriesTable)
																.set({ status: "posted", amount: 9n })
																.where(eq(LedgerTransactionEntriesTable.id, entry.id));
															await writer
																.update(LedgerAccountsTable)
																.set({ lockVersion: 2 })
																.where(eq(LedgerAccountsTable.id, accountId.toUUID()));
														})
													);
												})
											);
									},
								})
							),
						config
					);
			},
		});
		const concurrentRepository = new LedgerAccountStatementRepoLive(observedDb);
		const id = new TypeID("lst") as LedgerAccountStatementID;
		const statement = await runtime.runPromise(
			concurrentRepository.createStatement(...scope, id, request, parsed(request))
		);
		expect(committed).toBe(true);
		expect(statement.toResponse().ledgerAccountVersion).toBe(1);
		const entries = await runtime.runPromise(repository.getEntries(...scope, id, page));
		expect(entries).toMatchObject([
			{ amount: "7", transaction: { status: "pending", lockVersion: 1 } },
		]);
		const latest = await create(request);
		expect(latest.toResponse().ledgerAccountVersion).toBe(2);
		expect(await runtime.runPromise(repository.getEntries(...scope, latest.id, page))).toMatchObject([
			{ amount: "9", transaction: { status: "posted", lockVersion: 2 } },
		]);
	});
	it("carries historical balances through a period without activity", async () => {
		const statement = await create({
			startDatetime: "2090-01-01T00:00:00.000Z",
			endDatetime: "2090-02-01T00:00:00.000Z",
		});
		expect(statement.toResponse().startingBalances).toEqual(statement.toResponse().endingBalances);
		expect(statement.toResponse().startingBalances.some(balance => balance.amount !== "0")).toBe(
			true
		);
		expect(await runtime.runPromise(repository.getEntries(...scope, statement.id, page))).toEqual([]);
	});
	it("rejects a period whose summed balances leave the signed 64-bit range without saving", async () => {
		const request = {
			startDatetime: "2095-01-01T00:00:00.000Z",
			endDatetime: "2095-02-01T00:00:00.000Z",
		};
		const max = 9223372036854775807n;
		await addEntry("2094-12-01T00:00:00.000Z", "posted", "credit", max);
		await addEntry("2094-12-02T00:00:00.000Z", "posted", "credit", max);
		const id = new TypeID("lst") as LedgerAccountStatementID;
		expect(
			await runtime.runPromise(
				Effect.flip(repository.createStatement(...scope, id, request, parsed(request)))
			)
		).toBeInstanceOf(ConflictError);
		expect(
			await runtime.runPromise(Effect.flip(repository.getStatement(...scope, id)))
		).toBeInstanceOf(NotFoundError);
	});
	it("maps connection loss to unavailable and other database failures to a persistence failure", () => {
		const unavailable = Object.assign(new Error("connection terminated unexpectedly"), {
			_tag: "SqlError" as const,
		});
		const rejected = Object.assign(new Error("syntax error"), { _tag: "SqlError" as const });
		expect(mapStatementInfrastructureError(unavailable as never)).toBeInstanceOf(
			StatementRepositoryUnavailable
		);
		expect(mapStatementInfrastructureError(rejected as never)).toBeInstanceOf(
			StatementPersistenceFailure
		);
	});
});
