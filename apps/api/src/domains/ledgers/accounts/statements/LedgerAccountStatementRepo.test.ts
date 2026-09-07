import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import { NotFoundError } from "@/lib/errors";
import type {
	LedgerAccountID,
	LedgerAccountStatementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import {
	LedgerAccountsTable,
	LedgerAccountStatementsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/repo/schema";

import { LedgerAccountStatement } from "./LedgerAccountStatement";
import {
	type LedgerAccountStatementRepo,
	LedgerAccountStatementRepoTag,
	ledgerAccountStatementRepoLayer,
} from "./LedgerAccountStatementRepo";

describe("LedgerAccountStatementRepoLive", () => {
	const organizationId = new TypeID("org") as OrgID;
	const ledgerId = new TypeID("lgr") as LedgerID;
	const accountId = new TypeID("lat") as LedgerAccountID;
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const layer = Layer.merge(
		databaseLayer,
		ledgerAccountStatementRepoLayer.pipe(Layer.provide(databaseLayer))
	);
	const runtime = ManagedRuntime.make(layer);
	let repository: LedgerAccountStatementRepo;
	let db: Database["db"];

	beforeAll(async () => {
		repository = await runtime.runPromise(LedgerAccountStatementRepoTag);
		db = (await runtime.runPromise(DatabaseTag)).db;
		await db.insert(OrganizationsTable).values({
			id: organizationId.toString(),
			name: "Statement repository organization",
		});
		await db.insert(LedgersTable).values({
			id: ledgerId.toString(),
			organizationId: organizationId.toString(),
			name: "Statement repository ledger",
		});
		await db.insert(LedgerAccountsTable).values({
			id: accountId.toString(),
			organizationId: organizationId.toString(),
			ledgerId: ledgerId.toString(),
			name: "Statement repository account",
			normalBalance: "debit",
			currencyCode: "USD",
		});
	});

	afterAll(async () => {
		try {
			await db
				.delete(LedgerAccountStatementsTable)
				.where(eq(LedgerAccountStatementsTable.ledgerId, ledgerId.toString()));
			await db.delete(LedgerAccountsTable).where(eq(LedgerAccountsTable.id, accountId.toString()));
			await db.delete(LedgersTable).where(eq(LedgersTable.id, ledgerId.toString()));
			await db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, organizationId.toString()));
		} finally {
			await runtime.dispose();
		}
	});

	const statement = (id = new TypeID("lst") as LedgerAccountStatementID) =>
		new LedgerAccountStatement({
			id,
			ledgerId,
			accountId,
			statementDate: new Date("2025-01-01T00:00:00.000Z"),
			openingBalance: 10.5,
			closingBalance: 20.25,
			totalCredits: 30.75,
			totalDebits: 21,
			transactionCount: 4,
			metadata: { period: "monthly" },
			created: new Date("2025-01-02T00:00:00.000Z"),
			updated: new Date("2025-01-03T00:00:00.000Z"),
		});

	it("creates and gets a Statement by Statement ID alone", async () => {
		const input = statement();
		const created = await runtime.runPromise(repository.createStatement(input));
		const found = await runtime.runPromise(repository.getStatement(input.id));

		expect(created).toMatchObject({
			id: input.id,
			ledgerId,
			accountId,
			openingBalance: 10.5,
			closingBalance: 20.25,
			totalCredits: 30.75,
			totalDebits: 21,
			transactionCount: 4,
			metadata: { period: "monthly" },
		});
		expect(created.created).toBeInstanceOf(Date);
		expect(created.updated).toBeInstanceOf(Date);
		expect(found).toEqual(created);
	});

	it("fails with the existing Not Found error when the Statement is absent", async () => {
		const error = await runtime.runPromise(
			Effect.flip(repository.getStatement(new TypeID("lst") as LedgerAccountStatementID))
		);

		expect(error).toBeInstanceOf(NotFoundError);
		expect((error as Error).message).toMatch(/^Statement not found: lst_/);
	});

	it("keeps duplicate-key failures on the generic Effect error channel", async () => {
		const input = statement();
		await runtime.runPromise(repository.createStatement(input));
		const error = await runtime.runPromise(Effect.flip(repository.createStatement(input)));

		expect(error).not.toBeInstanceOf(NotFoundError);
	});

	it("keeps foreign-key failures on the generic Effect error channel", async () => {
		const input = statement();
		const invalid = new LedgerAccountStatement({
			...input,
			ledgerId: new TypeID("lgr") as LedgerID,
		});
		const error = await runtime.runPromise(Effect.flip(repository.createStatement(invalid)));

		expect(error).not.toBeInstanceOf(NotFoundError);
	});
});
