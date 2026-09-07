import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { signJWT } from "@/auth";
import { DatabaseTag, type DrizzleDatabase } from "@/db";
import {
	AssetsTable,
	LedgerAccountsTable,
	LedgerAccountStatementsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/db/schema";
import { buildServer } from "@/server";
import type {
	LedgerAccountStatementResponse,
	StatementEntry,
} from "./LedgerAccountStatementSchema";

const organizationId = new TypeID("org").toString();
const ledgerId = new TypeID("lgr").toString();
const accountId = new TypeID("lat").toString();
const contraId = new TypeID("lat").toString();
const uuid = (id: string) => TypeID.fromString(id).toUUID();
const assetId = new TypeID("ast").toUUID();
const prefix = `/api/ledgers/${ledgerId}/accounts/${accountId}/statements`;
let server: FastifyInstance;
let db: DrizzleDatabase;
let authorization: string;
beforeAll(async () => {
	server = await buildServer();
	db = (await server.runtime.runPromise(DatabaseTag)).db;
	authorization = `Bearer ${signJWT({ sub: organizationId, scope: ["org_admin"] })}`;
	await db
		.insert(OrganizationsTable)
		.values({ id: uuid(organizationId), name: "Statement HTTP integration" });
	await db
		.insert(LedgersTable)
		.values({ id: uuid(ledgerId), organizationId: uuid(organizationId), name: "Statements" });
	await db.insert(AssetsTable).values({
		id: assetId,
		organizationId: uuid(organizationId),
		code: "EUR",
		name: "Euro",
		minorUnitExponent: 2,
	});
	await db.insert(LedgerAccountsTable).values([
		{
			id: uuid(accountId),
			organizationId: uuid(organizationId),
			ledgerId: uuid(ledgerId),
			name: "Cash",
			normalBalance: "debit",
			assetId,
		},
		{
			id: uuid(contraId),
			organizationId: uuid(organizationId),
			ledgerId: uuid(ledgerId),
			name: "Liability",
			normalBalance: "credit",
			assetId,
		},
	]);
});
afterAll(async () => {
	try {
		await db
			.delete(LedgerAccountStatementsTable)
			.where(eq(LedgerAccountStatementsTable.organizationId, uuid(organizationId)));
		await db
			.delete(LedgerTransactionEntriesTable)
			.where(eq(LedgerTransactionEntriesTable.organizationId, uuid(organizationId)));
		await db
			.delete(LedgerTransactionsTable)
			.where(eq(LedgerTransactionsTable.organizationId, uuid(organizationId)));
		await db
			.delete(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.organizationId, uuid(organizationId)));
		await db.delete(LedgersTable).where(eq(LedgersTable.organizationId, uuid(organizationId)));
		await db.delete(AssetsTable).where(eq(AssetsTable.organizationId, uuid(organizationId)));
		await db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, uuid(organizationId)));
	} finally {
		await server.close();
	}
});

it("serves a saved snapshot through the real runtime after source edits and annotation replay", async () => {
	const entries = (amount: string) => [
		{ accountId, direction: "debit", amount, assetCode: "EUR", metadata: { source: "original" } },
		{ accountId: contraId, direction: "credit", amount, assetCode: "EUR" },
	];
	const transaction = await server.inject({
		method: "POST",
		url: `/api/ledgers/${ledgerId}/transactions`,
		headers: { authorization, "idempotency-key": crypto.randomUUID() },
		payload: {
			status: "pending",
			effectiveAt: "2026-01-15T10:00:00.000Z",
			ledgerEntries: entries("30"),
		},
	});
	expect(transaction.statusCode, transaction.body).toBe(201);
	const transactionId = transaction.json<{ id: string }>().id;
	const key = crypto.randomUUID();
	const period = {
		startDatetime: "2026-01-01T00:00:00.000Z",
		endDatetime: "2026-02-01T00:00:00.000Z",
		description: "January",
	};
	const created = await server.inject({
		method: "POST",
		url: prefix,
		headers: { authorization, "idempotency-key": key },
		payload: period,
	});
	expect(created.statusCode, created.body).toBe(200);
	const statement = created.json<LedgerAccountStatementResponse>();
	expect(statement).toMatchObject({ assetCode: "EUR", minorUnitExponent: 2 });
	expect(statement.endingBalances.find(balance => balance.balanceType === "pending")?.amount).toBe(
		"30"
	);
	const changed = await server.inject({
		method: "PUT",
		url: `/api/ledgers/${ledgerId}/transactions/${transactionId}`,
		headers: { authorization, "idempotency-key": crypto.randomUUID() },
		payload: { effectiveAt: "2026-01-15T10:00:00.000Z", ledgerEntries: entries("70") },
	});
	expect(changed.statusCode, changed.body).toBe(200);
	const saved = await server.inject({
		method: "GET",
		url: `${prefix}/${statement.id}/entries`,
		headers: { authorization },
	});
	expect(saved.statusCode, saved.body).toBe(200);
	expect(saved.json<StatementEntry[]>()).toMatchObject([
		{
			amount: "30",
			metadata: { source: "original" },
			transaction: { id: transactionId, status: "pending", lockVersion: 1 },
		},
	]);
	const annotated = await server.inject({
		method: "PUT",
		url: `${prefix}/${statement.id}`,
		headers: { authorization },
		payload: { lockVersion: 1, metadata: { reviewed: "yes" } },
	});
	expect(annotated.statusCode, annotated.body).toBe(200);
	expect(annotated.json()).toMatchObject({
		lockVersion: 2,
		metadata: { reviewed: "yes" },
		ledgerAccountVersion: statement.ledgerAccountVersion,
		endingBalances: statement.endingBalances,
	});
	expect(annotated.json()).not.toHaveProperty("description");
	const replay = await server.inject({
		method: "POST",
		url: prefix,
		headers: { authorization, "idempotency-key": key },
		payload: period,
	});
	expect(replay.statusCode, replay.body).toBe(200);
	expect(replay.json()).toEqual(annotated.json());
	const regenerated = await server.inject({
		method: "POST",
		url: prefix,
		headers: { authorization, "idempotency-key": crypto.randomUUID() },
		payload: period,
	});
	expect(regenerated.statusCode, regenerated.body).toBe(200);
	const next = regenerated.json<LedgerAccountStatementResponse>();
	expect(next.id).not.toBe(statement.id);
	expect(next.endingBalances.find(balance => balance.balanceType === "pending")?.amount).toBe("70");
	const listed = await server.inject({ method: "GET", url: prefix, headers: { authorization } });
	expect(listed.statusCode, listed.body).toBe(200);
	expect(listed.json<LedgerAccountStatementResponse[]>().map(item => item.id)).toEqual([
		next.id,
		statement.id,
	]);
	const read = await server.inject({
		method: "GET",
		url: `${prefix}/${statement.id}`,
		headers: { authorization },
	});
	expect(read.json()).toEqual(annotated.json());
	const stale = await server.inject({
		method: "PUT",
		url: `${prefix}/${statement.id}`,
		headers: { authorization },
		payload: { lockVersion: 1, description: "stale" },
	});
	expect(stale.statusCode).toBe(409);
});
