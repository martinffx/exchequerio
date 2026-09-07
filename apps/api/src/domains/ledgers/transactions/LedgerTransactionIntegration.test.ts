import { TypeID } from "typeid-js";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer, Option } from "effect";
import type { FastifyInstance, InjectOptions } from "fastify";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signJWT } from "@/auth";
import { Config } from "@/config";
import {
	newLedgerAccountID,
	newLedgerID,
	newLedgerTransactionID,
	newOrgID,
	type OrgID,
} from "@/lib/ids";
import {
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/db/schema";
import { makeServerRuntimeLayer } from "@/runtime";
import { buildServer } from "@/server";
import {
	IdempotencyPending,
	type IdempotencyService,
	IdempotencyServiceTag,
} from "@/services/IdempotencyService";

type JsonObject = Record<string, unknown>;

const config = new Config();
const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
const db = drizzle({ client: pool });
const organizationIds = new Set<string>();
const PENDING = Symbol("pending");
const idempotencyValues = new Map<string, string | typeof PENDING>();

const cacheKey = (organizationId: OrgID, action: string, key: string) =>
	`${organizationId.toString()}:${action}:${key}`;

const idempotencyService: IdempotencyService = {
	claim(organizationId, action, key) {
		return Effect.suspend(() => {
			const scopedKey = cacheKey(organizationId, action, key);
			const existing = idempotencyValues.get(scopedKey);
			if (existing === PENDING) return Effect.fail(new IdempotencyPending());
			if (existing !== undefined) return Effect.succeed(Option.fromUndefinedOr(existing));
			idempotencyValues.set(scopedKey, PENDING);
			return Effect.succeed(Option.none());
		});
	},
	complete(organizationId, action, key, resourceId) {
		return Effect.sync(() => {
			idempotencyValues.set(cacheKey(organizationId, action, key), resourceId);
		});
	},
	release(organizationId, action, key) {
		return Effect.sync(() => {
			idempotencyValues.delete(cacheKey(organizationId, action, key));
		});
	},
};

const auth = (organizationId: string) => ({
	Authorization: `Bearer ${signJWT({ sub: organizationId, scope: ["org_admin"] })}`,
	"idempotency-key": newLedgerTransactionID().toString(),
});

const expectIsoTimestamp = (value: unknown) => {
	expect(typeof value).toBe("string");
	expect(Number.isNaN(Date.parse(value as string))).toBe(false);
};

const balances = (response: JsonObject) => response.balances as JsonObject[];

const balance = (response: JsonObject, balanceType: string) =>
	balances(response).find(item => item.balanceType === balanceType);

describe("Transaction assembled journeys", () => {
	let server: FastifyInstance;

	beforeAll(async () => {
		server = await buildServer({
			runtimeLayer: makeServerRuntimeLayer(config, {
				idempotency: Layer.succeed(IdempotencyServiceTag, idempotencyService),
			}),
		});
	});

	afterAll(async () => {
		await server.close();
		await pool.end();
	});

	beforeEach(() => {
		idempotencyValues.clear();
	});

	afterEach(async () => {
		const ids = [...organizationIds].map(id => TypeID.fromString(id, "org").toUUID());
		if (ids.length === 0) return;
		await db
			.delete(LedgerTransactionEntriesTable)
			.where(inArray(LedgerTransactionEntriesTable.organizationId, ids));
		await db
			.delete(LedgerTransactionsTable)
			.where(inArray(LedgerTransactionsTable.organizationId, ids));
		await db.delete(LedgerAccountsTable).where(inArray(LedgerAccountsTable.organizationId, ids));
		await db.delete(LedgersTable).where(inArray(LedgersTable.organizationId, ids));
		await db.delete(OrganizationsTable).where(inArray(OrganizationsTable.id, ids));
		organizationIds.clear();
	});

	const createOrganization = async () => {
		const id = newOrgID().toString();
		organizationIds.add(id);
		await db
			.insert(OrganizationsTable)
			.values({ id: TypeID.fromString(id, "org").toUUID(), name: `Integration ${id}` });
		return id;
	};

	const inject = (organizationId: string, options: InjectOptions) =>
		server.inject({
			...options,
			headers: { ...auth(organizationId), ...options.headers },
		});

	const createLedger = async (organizationId: string, name: string) => {
		const response = await inject(organizationId, {
			method: "POST",
			url: "/api/ledgers",
			payload: { name },
		});
		expect(response.statusCode).toBe(201);
		return response.json<JsonObject>();
	};

	const createAccount = async (
		organizationId: string,
		ledgerId: string,
		name: string,
		normalBalance: "debit" | "credit"
	) => {
		const response = await inject(organizationId, {
			method: "POST",
			url: `/api/ledgers/${ledgerId}/accounts`,
			payload: { name, normalBalance, currencyCode: "EUR", minorUnitExponent: 2 },
		});
		expect(response.statusCode).toBe(201);
		return response.json<JsonObject>();
	};

	const getAccount = async (organizationId: string, ledgerId: string, accountId: string) => {
		const response = await inject(organizationId, {
			method: "GET",
			url: `/api/ledgers/${ledgerId}/accounts/${accountId}`,
		});
		expect(response.statusCode).toBe(200);
		return response.json<JsonObject>();
	};

	it("moves Pending balances through update and posting, while a separate Pending void stays queryable", async () => {
		const organizationId = await createOrganization();
		const ledger = await createLedger(organizationId, "Pending journey");
		const ledgerId = ledger.id as string;
		const debit = await createAccount(organizationId, ledgerId, "Cash", "debit");
		const credit = await createAccount(organizationId, ledgerId, "Payable", "credit");
		const debitId = debit.id as string;
		const creditId = credit.id as string;
		const collection = `/api/ledgers/${ledgerId}/transactions`;

		const createdResponse = await inject(organizationId, {
			method: "POST",
			url: collection,
			headers: { "idempotency-key": "pending-create" },
			payload: {
				status: "pending",
				description: "Initial pending transfer",
				ledgerEntries: [
					{ accountId: debitId, direction: "debit", amount: 100, currencyCode: "EUR" },
					{ accountId: creditId, direction: "credit", amount: 100, currencyCode: "EUR" },
				],
			},
		});
		expect(createdResponse.statusCode).toBe(201);
		const created = createdResponse.json<JsonObject>();
		expect(created).toMatchObject({ status: "pending", description: "Initial pending transfer" });
		expect(created).not.toHaveProperty("postedAt");
		expectIsoTimestamp(created.created);
		expectIsoTimestamp(created.updated);

		const pendingDebit = await getAccount(organizationId, ledgerId, debitId);
		expect(balance(pendingDebit, "pending")).toEqual({
			balanceType: "pending",
			credits: 0,
			debits: 100,
			amount: 100,
		});
		expect(balance(pendingDebit, "posted")).toEqual({
			balanceType: "posted",
			credits: 0,
			debits: 0,
			amount: 0,
		});
		expect(balance(pendingDebit, "availableBalance")).toEqual({
			balanceType: "availableBalance",
			credits: 0,
			debits: 0,
			amount: 0,
		});

		const transactionId = created.id as string;
		const replacedResponse = await inject(organizationId, {
			method: "PUT",
			url: `${collection}/${transactionId}`,
			payload: {
				description: "Expanded pending transfer",
				ledgerEntries: [
					{ accountId: debitId, direction: "debit", amount: 175, currencyCode: "EUR" },
					{ accountId: creditId, direction: "credit", amount: 175, currencyCode: "EUR" },
				],
			},
		});
		expect(replacedResponse.statusCode).toBe(200);
		expect(replacedResponse.json()).toMatchObject({
			id: transactionId,
			status: "pending",
			description: "Expanded pending transfer",
		});
		const replacedDebit = await getAccount(organizationId, ledgerId, debitId);
		expect(balance(replacedDebit, "pending")).toEqual({
			balanceType: "pending",
			credits: 0,
			debits: 175,
			amount: 175,
		});
		expect(balance(replacedDebit, "posted")).toEqual({
			balanceType: "posted",
			credits: 0,
			debits: 0,
			amount: 0,
		});
		expect(balance(replacedDebit, "availableBalance")).toEqual({
			balanceType: "availableBalance",
			credits: 0,
			debits: 0,
			amount: 0,
		});

		const postedResponse = await inject(organizationId, {
			method: "POST",
			url: `${collection}/${transactionId}/post`,
		});
		expect(postedResponse.statusCode).toBe(200);
		const posted = postedResponse.json<JsonObject>();
		expect(posted).toMatchObject({ id: transactionId, status: "posted" });
		expectIsoTimestamp(posted.postedAt);
		const postedDebit = await getAccount(organizationId, ledgerId, debitId);
		expect(balance(postedDebit, "pending")).toEqual({
			balanceType: "pending",
			credits: 0,
			debits: 175,
			amount: 175,
		});
		expect(balance(postedDebit, "posted")).toEqual({
			balanceType: "posted",
			credits: 0,
			debits: 175,
			amount: 175,
		});
		expect(balance(postedDebit, "availableBalance")).toEqual({
			balanceType: "availableBalance",
			credits: 0,
			debits: 175,
			amount: 175,
		});
		const fetchedPosted = await inject(organizationId, {
			method: "GET",
			url: `${collection}/${transactionId}`,
		});
		expect(fetchedPosted.statusCode).toBe(200);
		expect(fetchedPosted.json()).toEqual(posted);

		const voidCandidateResponse = await inject(organizationId, {
			method: "POST",
			url: collection,
			headers: { "idempotency-key": "pending-void" },
			payload: {
				status: "pending",
				description: "Void this pending transaction",
				ledgerEntries: [
					{ accountId: debitId, direction: "debit", amount: 25, currencyCode: "EUR" },
					{ accountId: creditId, direction: "credit", amount: 25, currencyCode: "EUR" },
				],
			},
		});
		expect(voidCandidateResponse.statusCode).toBe(201);
		const voidCandidate = voidCandidateResponse.json<JsonObject>();
		const retainedEntries = voidCandidate.ledgerEntries;
		const beforeVoid = await getAccount(organizationId, ledgerId, debitId);
		expect(balance(beforeVoid, "pending")).toEqual({
			balanceType: "pending",
			credits: 0,
			debits: 200,
			amount: 200,
		});
		expect(balance(beforeVoid, "posted")).toEqual({
			balanceType: "posted",
			credits: 0,
			debits: 175,
			amount: 175,
		});
		expect(balance(beforeVoid, "availableBalance")).toEqual({
			balanceType: "availableBalance",
			credits: 0,
			debits: 175,
			amount: 175,
		});
		const voidResponse = await inject(organizationId, {
			method: "DELETE",
			url: `${collection}/${voidCandidate.id as string}`,
		});
		expect(voidResponse.statusCode).toBe(204);
		const fetchedVoided = await inject(organizationId, {
			method: "GET",
			url: `${collection}/${voidCandidate.id as string}`,
		});
		expect(fetchedVoided.statusCode).toBe(200);
		expect(fetchedVoided.json()).toMatchObject({
			id: voidCandidate.id,
			status: "voided",
			ledgerEntries: retainedEntries,
		});
		const afterVoid = await getAccount(organizationId, ledgerId, debitId);
		expect(balance(afterVoid, "pending")).toEqual({
			balanceType: "pending",
			credits: 0,
			debits: 175,
			amount: 175,
		});
		expect(balance(afterVoid, "posted")).toEqual({
			balanceType: "posted",
			credits: 0,
			debits: 175,
			amount: 175,
		});
		expect(balance(afterVoid, "availableBalance")).toEqual({
			balanceType: "availableBalance",
			credits: 0,
			debits: 175,
			amount: 175,
		});
	});

	it("creates Posted once and replays the first representation for a different body", async () => {
		const organizationId = await createOrganization();
		const ledger = await createLedger(organizationId, "Posted journey");
		const ledgerId = ledger.id as string;
		const debit = await createAccount(organizationId, ledgerId, "Posted debit", "debit");
		const credit = await createAccount(organizationId, ledgerId, "Posted credit", "credit");
		const debitId = debit.id as string;
		const creditId = credit.id as string;
		const collection = `/api/ledgers/${ledgerId}/transactions`;
		const key = "direct-posted";

		const firstResponse = await inject(organizationId, {
			method: "POST",
			url: collection,
			headers: { "idempotency-key": key },
			payload: {
				status: "posted",
				description: "First body wins",
				ledgerEntries: [
					{ accountId: debitId, direction: "debit", amount: 240, currencyCode: "EUR" },
					{ accountId: creditId, direction: "credit", amount: 240, currencyCode: "EUR" },
				],
			},
		});
		expect(firstResponse.statusCode).toBe(201);
		const first = firstResponse.json<JsonObject>();
		expect(first).toMatchObject({ status: "posted", description: "First body wins" });
		expect(first.postedAt).toBe(first.created);
		expectIsoTimestamp(first.postedAt);

		const replayResponse = await inject(organizationId, {
			method: "POST",
			url: collection,
			headers: { "idempotency-key": key },
			payload: {
				status: "pending",
				description: "Ignored second body",
				ledgerEntries: [
					{ accountId: debitId, direction: "debit", amount: 999, currencyCode: "EUR" },
					{ accountId: creditId, direction: "credit", amount: 999, currencyCode: "EUR" },
				],
			},
		});
		expect(replayResponse.statusCode).toBe(201);
		expect(replayResponse.json()).toEqual(first);

		const [transactions, entries] = await Promise.all([
			db
				.select({ id: LedgerTransactionsTable.id })
				.from(LedgerTransactionsTable)
				.where(
					eq(LedgerTransactionsTable.organizationId, TypeID.fromString(organizationId, "org").toUUID())
				),
			db
				.select({ id: LedgerTransactionEntriesTable.id })
				.from(LedgerTransactionEntriesTable)
				.where(
					eq(
						LedgerTransactionEntriesTable.organizationId,
						TypeID.fromString(organizationId, "org").toUUID()
					)
				),
		]);
		expect(transactions).toHaveLength(1);
		expect(entries).toHaveLength(2);
		const postedDebit = await getAccount(organizationId, ledgerId, debitId);
		expect(balance(postedDebit, "pending")).toEqual({
			balanceType: "pending",
			credits: 0,
			debits: 240,
			amount: 240,
		});
		expect(balance(postedDebit, "posted")).toEqual({
			balanceType: "posted",
			credits: 0,
			debits: 240,
			amount: 240,
		});
	});

	it("commits concurrent writes to hot Accounts through OCC retries", async () => {
		const organizationId = await createOrganization();
		const ledger = await createLedger(organizationId, "Hot Account contention");
		const ledgerId = ledger.id as string;
		const debit = await createAccount(organizationId, ledgerId, "Hot debit", "debit");
		const credit = await createAccount(organizationId, ledgerId, "Hot credit", "credit");
		const debitId = debit.id as string;
		const creditId = credit.id as string;
		const writes = 10;

		const responses = await Promise.all(
			Array.from({ length: writes }, (_, index) =>
				inject(organizationId, {
					method: "POST",
					url: `/api/ledgers/${ledgerId}/transactions`,
					headers: { "idempotency-key": `hot-account-${index}` },
					payload: {
						status: "pending",
						ledgerEntries: [
							{ accountId: debitId, direction: "debit", amount: 1, currencyCode: "EUR" },
							{ accountId: creditId, direction: "credit", amount: 1, currencyCode: "EUR" },
						],
					},
				})
			)
		);

		expect(responses.map(response => response.statusCode)).toEqual(Array(writes).fill(201));
		const hotDebit = await getAccount(organizationId, ledgerId, debitId);
		expect(balance(hotDebit, "pending")).toEqual({
			balanceType: "pending",
			credits: 0,
			debits: writes,
			amount: writes,
		});
	});

	it("returns indistinguishable 404 contracts for missing and cross-tenant resources", async () => {
		const ownerId = await createOrganization();
		const requesterId = await createOrganization();
		const ownerLedger = await createLedger(ownerId, "Owner ledger");
		const requesterLedger = await createLedger(requesterId, "Requester ledger");
		const ownerLedgerId = ownerLedger.id as string;
		const requesterLedgerId = requesterLedger.id as string;
		const ownerDebit = await createAccount(ownerId, ownerLedgerId, "Owner debit", "debit");
		const ownerCredit = await createAccount(ownerId, ownerLedgerId, "Owner credit", "credit");
		const transactionResponse = await inject(ownerId, {
			method: "POST",
			url: `/api/ledgers/${ownerLedgerId}/transactions`,
			headers: { "idempotency-key": "tenant-isolation" },
			payload: {
				status: "pending",
				ledgerEntries: [
					{ accountId: ownerDebit.id, direction: "debit", amount: 10, currencyCode: "EUR" },
					{ accountId: ownerCredit.id, direction: "credit", amount: 10, currencyCode: "EUR" },
				],
			},
		});
		expect(transactionResponse.statusCode).toBe(201);
		const ownerTransaction = transactionResponse.json<JsonObject>();

		const missingLedgerId = newLedgerID().toString();
		const missingTransactionId = newLedgerTransactionID().toString();
		const missingAccountId = newLedgerAccountID().toString();
		const cases = [
			`/api/ledgers/${missingLedgerId}`,
			`/api/ledgers/${ownerLedgerId}`,
			`/api/ledgers/${missingLedgerId}/transactions`,
			`/api/ledgers/${ownerLedgerId}/transactions`,
			`/api/ledgers/${requesterLedgerId}/transactions/${missingTransactionId}`,
			`/api/ledgers/${ownerLedgerId}/transactions/${ownerTransaction.id as string}`,
			`/api/ledgers/${requesterLedgerId}/accounts/${missingAccountId}`,
			`/api/ledgers/${ownerLedgerId}/accounts/${ownerDebit.id as string}`,
			`/api/ledgers/${requesterLedgerId}/accounts/lat_00000000000000000000000001`,
		] as const;

		const responses = await Promise.all(
			cases.map(url => inject(requesterId, { method: "GET", url }))
		);
		for (const [index, response] of responses.entries()) {
			expect(response.statusCode, cases[index]).toBe(404);
			const body = response.json<JsonObject>();
			expect(body).toMatchObject({ type: "NOT_FOUND", status: 404, title: "Not Found" });
			expect(JSON.stringify(body)).not.toContain(ownerId);
		}
		for (const [missing, crossTenant] of [
			[responses[0], responses[1]],
			[responses[2], responses[3]],
			[responses[4], responses[5]],
			[responses[6], responses[7]],
		] as const) {
			expect(Object.keys(missing.json()).sort()).toEqual(Object.keys(crossTenant.json()).sort());
		}
	});
});
