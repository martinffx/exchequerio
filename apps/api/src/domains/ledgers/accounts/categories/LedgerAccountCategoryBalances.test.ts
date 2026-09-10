import type { LedgerAccountCategoryBalancesResponse } from "./LedgerAccountCategorySchema";
import { randomUUID } from "node:crypto";
import { buildServer } from "@/server";
import { signJWT } from "@/auth";
import { LedgerTransactionEntriesTable, LedgerTransactionsTable } from "@/db/schema";
import { TypeID } from "typeid-js";
import { Effect, Layer, ManagedRuntime } from "effect";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { DatabaseTag, makeDatabaseLive, type Database } from "@/db";
import {
	AssetsTable,
	OrganizationsTable,
	LedgersTable,
	LedgerAccountsTable,
	LedgerAccountCategoriesTable,
	LedgerAccountCategoryAccountsTable,
	LedgerAccountCategoryParentsTable,
} from "@/db/schema";
import { newOrgID, newLedgerID, newLedgerAccountID, type LedgerAccountCategoryID } from "@/lib/ids";
import { INT64_MAX } from "@/lib/amounts";
import { CategoryNotFound } from "./LedgerAccountCategoryErrors";
import {
	LedgerAccountCategoryRepoTag,
	LedgerAccountCategoryRepoLive,
	ledgerAccountCategoryRepoLayer,
	type LedgerAccountCategoryRepo,
} from "./LedgerAccountCategoryRepo";

const runtime = ManagedRuntime.make(
	ledgerAccountCategoryRepoLayer.pipe(Layer.provideMerge(makeDatabaseLive(new Config().databaseUrl)))
);
const org = newOrgID();
const ledger = newLedgerID();
const asset = new TypeID("ast");
let database: Database;
let repo: LedgerAccountCategoryRepo;
const ownership = { organizationId: org.toUUID(), ledgerId: ledger.toUUID() };

function barrier() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => {
		resolve = done;
	});
	return { promise, resolve };
}

async function category(normalBalance: "debit" | "credit" = "debit") {
	const id = new TypeID("lac") as LedgerAccountCategoryID;
	await database.db
		.insert(LedgerAccountCategoriesTable)
		.values({ ...ownership, id: id.toUUID(), name: "Balance test", normalBalance });
	return id;
}
async function account(
	categoryId: LedgerAccountCategoryID,
	counters: Partial<typeof LedgerAccountsTable.$inferInsert> = {}
) {
	const id = newLedgerAccountID();
	const debitNormal = counters.normalBalance === "debit";
	const postedDebits = counters.postedDebits ?? 0n;
	const postedCredits = counters.postedCredits ?? 0n;
	const pendingDebits = counters.pendingDebits ?? 0n;
	const pendingCredits = counters.pendingCredits ?? 0n;
	const availableDebits = debitNormal ? postedDebits : pendingDebits;
	const availableCredits = debitNormal ? pendingCredits : postedCredits;
	const amount = (debits: bigint, credits: bigint) =>
		debitNormal ? debits - credits : credits - debits;
	await database.db.insert(LedgerAccountsTable).values({
		...ownership,
		id: id.toUUID(),
		name: id.toString(),
		normalBalance: "credit",
		assetId: asset.toUUID(),
		...counters,
		postedAmount: amount(postedDebits, postedCredits),
		pendingAmount: amount(pendingDebits, pendingCredits),
		availableDebits,
		availableCredits,
		availableAmount: amount(availableDebits, availableCredits),
	});
	await runtime.runPromise(repo.linkAccountToCategory(org, ledger, categoryId, id));
	return id;
}
const read = (id: LedgerAccountCategoryID) =>
	runtime
		.runPromise(repo.getLedgerAccountCategoryBalances(org, ledger, id))
		.then(value => value.toResponse());

beforeAll(async () => {
	database = await runtime.runPromise(DatabaseTag);
	repo = await runtime.runPromise(LedgerAccountCategoryRepoTag);
	await database.db
		.insert(OrganizationsTable)
		.values({ id: org.toUUID(), name: "Category balances" });
	await database.db
		.insert(LedgersTable)
		.values({ ...ownership, id: ledger.toUUID(), name: "Balances" });
	await database.db.insert(AssetsTable).values({
		id: asset.toUUID(),
		organizationId: org.toUUID(),
		code: "USD",
		name: "Dollar",
		minorUnitExponent: 2,
	});
});
afterAll(async () => {
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

describe("Category balance rollups", () => {
	it.each([
		["ECONNREFUSED", 503],
		["XX000", 500],
	] as const)("maps balance query failure %s without losing its cause", async (code, statusCode) => {
		const cause = Object.assign(new Error("query failure"), { code });
		const repository = new LedgerAccountCategoryRepoLive({
			execute: () => Effect.fail(cause),
		} as never);
		const error = await Effect.runPromise(
			Effect.flip(
				repository.getLedgerAccountCategoryBalances(
					org,
					ledger,
					new TypeID("lac") as LedgerAccountCategoryID
				)
			)
		);
		expect(error).toMatchObject({ statusCode, cause });
	});

	it("distinguishes empty, absent and foreign categories", async () => {
		const root = await category();
		expect(await read(root)).toEqual({
			categoryId: root.toString(),
			normalBalance: "debit",
			assets: [],
		});
		expect(
			await runtime.runPromise(
				Effect.flip(repo.getLedgerAccountCategoryBalances(newOrgID(), ledger, root))
			)
		).toBeInstanceOf(CategoryNotFound);
		expect(
			await runtime.runPromise(
				Effect.flip(repo.getLedgerAccountCategoryBalances(org, newLedgerID(), root))
			)
		).toBeInstanceOf(CategoryNotFound);
		expect(
			await runtime.runPromise(
				Effect.flip(
					repo.getLedgerAccountCategoryBalances(
						org,
						ledger,
						new TypeID("lac") as LedgerAccountCategoryID
					)
				)
			)
		).toBeInstanceOf(CategoryNotFound);
	});
	it.each(["debit", "credit"] as const)(
		"uses %s Category orientation, not Account availability",
		async normalBalance => {
			const root = await category(normalBalance);
			await account(root, {
				postedDebits: 100n,
				postedCredits: 20n,
				pendingDebits: 150n,
				pendingCredits: 50n,
			});
			const result = await read(root);
			expect(result.assets[0]).toEqual({
				assetId: asset.toString(),
				assetCode: "USD",
				minorUnitExponent: 2,
				balances: [
					{
						balanceType: "pending",
						debits: "150",
						credits: "50",
						amount: normalBalance === "debit" ? "100" : "-100",
					},
					{
						balanceType: "posted",
						debits: "100",
						credits: "20",
						amount: normalBalance === "debit" ? "80" : "-80",
					},
					{
						balanceType: "availableBalance",
						debits: normalBalance === "debit" ? "100" : "150",
						credits: normalBalance === "debit" ? "50" : "20",
						amount: normalBalance === "debit" ? "50" : "-130",
					},
				],
			});
		}
	);
	it("counts shared descendants once and remains safe with a stored cycle", async () => {
		const root = await category();
		const left = await category();
		const right = await category();
		const leaf = await category();
		for (const [child, parent] of [
			[left, root],
			[right, root],
			[leaf, left],
			[leaf, right],
		]) {
			await runtime.runPromise(repo.linkCategoryToParent(org, ledger, child, parent));
		}
		const member = await account(leaf, { postedDebits: 7n, pendingDebits: 7n });
		await runtime.runPromise(repo.linkAccountToCategory(org, ledger, root, member));
		expect((await read(root)).assets[0].balances[1].amount).toBe("7");
		await database.db
			.insert(LedgerAccountCategoryParentsTable)
			.values({ ...ownership, categoryId: root.toUUID(), parentCategoryId: leaf.toUUID() });
		expect((await read(root)).assets[0].balances[1].amount).toBe("7");
		await runtime.runPromise(repo.unlinkAccountFromCategory(org, ledger, root, member));
		expect((await read(root)).assets[0].balances[1].amount).toBe("7");
		await runtime.runPromise(repo.unlinkAccountFromCategory(org, ledger, leaf, member));
		expect((await read(root)).assets).toEqual([]);
	});
	it("groups by immutable Asset ID, retains zeros and reads renamed Asset metadata", async () => {
		const root = await category();
		const other = new TypeID("ast");
		await database.db.insert(AssetsTable).values({
			id: other.toUUID(),
			organizationId: org.toUUID(),
			code: "EUR",
			name: "Euro",
			minorUnitExponent: 3,
		});
		await account(root);
		await account(root, { assetId: other.toUUID(), postedDebits: 123n, pendingDebits: 123n });
		await database.db
			.update(AssetsTable)
			.set({ code: "EUR:OLD" })
			.where(eq(AssetsTable.id, other.toUUID()));
		await database.db.insert(AssetsTable).values({
			id: new TypeID("ast").toUUID(),
			organizationId: org.toUUID(),
			code: "EUR",
			name: "Replacement",
			minorUnitExponent: 0,
		});
		const result = await read(root);
		expect(result.assets.map(value => value.assetId)).toEqual(
			[asset.toString(), other.toString()].sort()
		);
		expect(result.assets.find(value => value.assetId === other.toString())).toMatchObject({
			assetCode: "EUR:OLD",
			minorUnitExponent: 3,
		});
		expect(
			result.assets
				.find(value => value.assetId === asset.toString())
				?.balances.every(value => value.amount === "0")
		).toBe(true);
	});
	it("returns committed membership while a new link is in flight, then includes it on the next read", async () => {
		const root = await category();
		const holding = await category();
		const member = await account(holding, { pendingDebits: 500n, postedDebits: 500n });
		const inserted = barrier();
		const release = barrier();
		const mutation = database.db.transaction(async tx => {
			await tx
				.insert(LedgerAccountCategoryAccountsTable)
				.values({ ...ownership, categoryId: root.toUUID(), accountId: member.toUUID() });
			inserted.resolve();
			await release.promise;
		});
		try {
			await Promise.race([inserted.promise, mutation]);
			expect((await read(root)).assets).toEqual([]);
		} finally {
			release.resolve();
			await mutation;
		}
		expect((await read(root)).assets[0].balances[1].amount).toBe("500");
	});
	it("never includes half of an uncommitted multi-Account projection update", async () => {
		const root = await category();
		const first = await account(root);
		const second = await account(root);
		const updated = barrier();
		const release = barrier();
		const mutation = database.db.transaction(async tx => {
			await tx
				.update(LedgerAccountsTable)
				.set({ pendingDebits: 100n, postedDebits: 100n })
				.where(eq(LedgerAccountsTable.id, first.toUUID()));
			updated.resolve();
			await release.promise;
			await tx
				.update(LedgerAccountsTable)
				.set({ pendingCredits: 100n, postedCredits: 100n })
				.where(eq(LedgerAccountsTable.id, second.toUUID()));
		});
		try {
			await Promise.race([updated.promise, mutation]);
			expect((await read(root)).assets[0].balances[1]).toMatchObject({
				amount: "0",
				credits: "0",
				debits: "0",
			});
		} finally {
			release.resolve();
			await mutation;
		}
		expect((await read(root)).assets[0].balances[1]).toMatchObject({
			amount: "0",
			credits: "100",
			debits: "100",
		});
	});
	it("reflects the real Transaction lifecycle through the authenticated balances endpoint", async () => {
		const server = await buildServer();
		server.log.level = "silent";
		try {
			const root = await category();
			const contraCategory = await category();
			const member = await account(root, { normalBalance: "debit" });
			const contra = await account(contraCategory);
			const authorization = `Bearer ${signJWT({ sub: org.toString(), scope: ["super_admin"] })}`;
			const url = `/api/ledgers/${ledger.toString()}/accounts/categories/${root.toString()}/balances`;
			const entries = (amount: string) => [
				{ accountId: member.toString(), assetId: asset.toString(), direction: "debit", amount },
				{ accountId: contra.toString(), assetId: asset.toString(), direction: "credit", amount },
			];
			const amounts = async () => {
				const response = await server.inject({ method: "GET", url, headers: { authorization } });
				expect(response.statusCode).toBe(200);
				return response
					.json<LedgerAccountCategoryBalancesResponse>()
					.assets[0].balances.map((value: { amount: string }) => value.amount);
			};
			const base = `/api/ledgers/${ledger.toString()}/transactions`;
			const create = await server.inject({
				method: "POST",
				url: base,
				headers: { authorization, "idempotency-key": randomUUID() },
				payload: { status: "pending", ledgerEntries: entries("20") },
			});
			expect(create.statusCode).toBe(201);
			expect(await amounts()).toEqual(["20", "0", "0"]);
			const transactionUrl = `${base}/${create.json<{ id: string }>().id}`;
			const update = await server.inject({
				method: "PUT",
				url: transactionUrl,
				headers: { authorization, "idempotency-key": randomUUID() },
				payload: { ledgerEntries: entries("30") },
			});
			expect(update.statusCode).toBe(200);
			expect(await amounts()).toEqual(["30", "0", "0"]);
			const posted = await server.inject({
				method: "POST",
				url: `${transactionUrl}/post`,
				headers: { authorization, "idempotency-key": randomUUID() },
			});
			expect(posted.statusCode).toBe(200);
			expect(await amounts()).toEqual(["30", "30", "30"]);
			const pending = await server.inject({
				method: "POST",
				url: base,
				headers: { authorization, "idempotency-key": randomUUID() },
				payload: { status: "pending", ledgerEntries: entries("5") },
			});
			expect(pending.statusCode).toBe(201);
			expect(await amounts()).toEqual(["35", "30", "30"]);
			const voided = await server.inject({
				method: "DELETE",
				url: `${base}/${pending.json<{ id: string }>().id}`,
				headers: { authorization, "idempotency-key": randomUUID() },
			});
			expect(voided.statusCode).toBe(204);
			expect(await amounts()).toEqual(["30", "30", "30"]);
			expect((await server.inject({ method: "GET", url })).statusCode).toBe(401);
			const noPermissions = `Bearer ${signJWT({ sub: org.toString(), scope: [] })}`;
			expect(
				(await server.inject({ method: "GET", url, headers: { authorization: noPermissions } }))
					.statusCode
			).toBe(403);
			const readOnly = `Bearer ${signJWT({ sub: org.toString(), scope: ["org_readonly"] })}`;
			expect(
				(await server.inject({ method: "GET", url, headers: { authorization: readOnly } })).statusCode
			).toBe(200);
			const foreign = `Bearer ${signJWT({ sub: newOrgID().toString(), scope: ["super_admin"] })}`;
			expect(
				(await server.inject({ method: "GET", url, headers: { authorization: foreign } })).statusCode
			).toBe(404);
		} finally {
			await server.close();
		}
	});

	it("rejects a visible longer cycle and preserves duplicate links", async () => {
		const a = await category();
		const b = await category();
		const c = await category();
		await runtime.runPromise(repo.linkCategoryToParent(org, ledger, b, a));
		await runtime.runPromise(repo.linkCategoryToParent(org, ledger, c, b));
		await expect(runtime.runPromise(repo.linkCategoryToParent(org, ledger, a, c))).rejects.toThrow(
			"cycle"
		);
		await runtime.runPromise(repo.linkCategoryToParent(org, ledger, b, a));
	});
	it("preserves exact int64 totals and rejects overflowing counters even when net is zero", async () => {
		const root = await category();
		await account(root, { postedCredits: INT64_MAX - 1n, pendingCredits: INT64_MAX - 1n });
		await account(root, { postedCredits: 1n, pendingCredits: 1n });
		expect((await read(root)).assets[0].balances[1].credits).toBe(INT64_MAX.toString());
		await account(root, {
			postedCredits: 1n,
			pendingCredits: 1n,
			postedDebits: INT64_MAX,
			pendingDebits: INT64_MAX,
		});
		await account(root, { postedDebits: 1n, pendingDebits: 1n });
		await expect(read(root)).rejects.toMatchObject({ statusCode: 409, retryable: false });
	});
});
