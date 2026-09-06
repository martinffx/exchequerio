import { inArray } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";
import { DateTime } from "luxon";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import { Ledger } from "@/domains/ledgers/Ledger";
import { type LedgerRepo, LedgerRepoTag, ledgerRepoLayer } from "@/domains/ledgers/LedgerRepo";
import {
	type LedgerAccountRepo,
	LedgerAccountRepoTag,
	ledgerAccountRepoLayer,
} from "@/domains/ledgers/accounts/LedgerAccountRepo";
import { LedgerAccount } from "@/domains/ledgers/accounts/LedgerAccount";
import { LedgerTransaction } from "@/domains/ledgers/transactions/LedgerTransaction";
import {
	type LedgerTransactionRepo,
	LedgerTransactionRepoTag,
	ledgerTransactionRepoLayer,
} from "@/domains/ledgers/transactions/LedgerTransactionRepo";
import { Organization } from "@/domains/organizations/Organization";
import {
	type OrganizationRepo,
	OrganizationRepoTag,
	organizationRepoLayer,
} from "@/domains/organizations/OrganizationRepo";
import { ConflictError, NotFoundError } from "@/lib/errors";
import {
	newLedgerAccountID,
	newLedgerAccountSettlementID,
	newLedgerID,
	newLedgerTransactionEntryID,
	newLedgerTransactionID,
	newOrgID,
	type LedgerAccountID,
	type LedgerID,
	type OrgID,
} from "@/repo/entities/types";
import {
	LedgerAccountSettlementsTable,
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/repo/schema";

import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import {
	type LedgerAccountSettlementRepo,
	LedgerAccountSettlementRepoTag,
	ledgerAccountSettlementRepoLayer,
} from "./LedgerAccountSettlementRepo";

type TestContext = {
	organizationId: OrgID;
	ledgerId: LedgerID;
	settledAccountId: LedgerAccountID;
	contraAccountId: LedgerAccountID;
};

const settlement = (
	owner: TestContext,
	overrides: Partial<ConstructorParameters<typeof LedgerAccountSettlementEntity>[0]> = {}
) =>
	new LedgerAccountSettlementEntity({
		id: newLedgerAccountSettlementID(),
		organizationId: owner.organizationId,
		settledAccountId: owner.settledAccountId,
		contraAccountId: owner.contraAccountId,
		amount: 0,
		normalBalance: "debit",
		currency: "USD",
		status: "drafting",
		created: DateTime.utc(),
		updated: DateTime.utc(),
		...overrides,
	});

describe("LedgerAccountSettlementRepoLive", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const reposLayer = Layer.mergeAll(
		ledgerTransactionRepoLayer,
		ledgerAccountSettlementRepoLayer,
		ledgerAccountRepoLayer,
		ledgerRepoLayer,
		organizationRepoLayer
	).pipe(Layer.provideMerge(databaseLayer));
	type TestServices =
		| LedgerTransactionRepo
		| LedgerAccountSettlementRepo
		| LedgerAccountRepo
		| LedgerRepo
		| OrganizationRepo
		| Database;
	const runtime: ManagedRuntime.ManagedRuntime<TestServices, never> =
		ManagedRuntime.make(reposLayer);
	const organizationIds: OrgID[] = [];
	let context: TestContext;
	let otherLedger: TestContext;
	let otherOrganization: TestContext;

	const runRepo = <A, E>(use: (repository: LedgerAccountSettlementRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(LedgerAccountSettlementRepoTag.pipe(Effect.flatMap(use)));
	const runAccountRepo = <A, E>(use: (repository: LedgerAccountRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(LedgerAccountRepoTag.pipe(Effect.flatMap(use)));
	const runLedgerRepo = <A, E>(use: (repository: LedgerRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(LedgerRepoTag.pipe(Effect.flatMap(use)));
	const runOrganizationRepo = <A, E>(use: (repository: OrganizationRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(OrganizationRepoTag.pipe(Effect.flatMap(use)));
	const runTransactionRepo = <A, E>(
		use: (repository: LedgerTransactionRepo) => Effect.Effect<A, E>
	) => runtime.runPromise(LedgerTransactionRepoTag.pipe(Effect.flatMap(use)));
	const database = () => runtime.runPromise(DatabaseTag);

	const createContext = async (
		organizationId = newOrgID(),
		createOrganization = true
	): Promise<TestContext> => {
		const ledgerId = newLedgerID();
		if (createOrganization) {
			organizationIds.push(organizationId);
			await runOrganizationRepo(repository =>
				repository.createOrganization(
					Organization.fromRequest(organizationId, {
						name: `Settlement test ${organizationId.toString()}`,
					})
				)
			);
		}
		await runLedgerRepo(repository =>
			repository.createLedger(Ledger.fromRequest(ledgerId, organizationId, { name: "Ledger" }))
		);
		const settledAccountId = newLedgerAccountID();
		const contraAccountId = newLedgerAccountID();
		await runAccountRepo(repository =>
			Effect.all(
				[
					LedgerAccount.fromCreateRequest(settledAccountId, organizationId, ledgerId, {
						name: `Settled ${settledAccountId.toString()}`,
						normalBalance: "debit",
						currencyCode: "USD",
					}),
					LedgerAccount.fromCreateRequest(contraAccountId, organizationId, ledgerId, {
						name: `Contra ${contraAccountId.toString()}`,
						normalBalance: "credit",
						currencyCode: "USD",
					}),
				].map(account => repository.createAccount(account)),
				{ concurrency: 1 }
			)
		);
		return { organizationId, ledgerId, settledAccountId, contraAccountId };
	};

	beforeAll(async () => {
		context = await createContext();
		otherLedger = await createContext(context.organizationId, false);
		otherOrganization = await createContext();
	});

	afterAll(async () => {
		try {
			const db = (await database()).db;
			const ids = organizationIds.map(id => id.toString());
			await db
				.delete(LedgerAccountSettlementsTable)
				.where(inArray(LedgerAccountSettlementsTable.organizationId, ids));
			await db
				.delete(LedgerTransactionEntriesTable)
				.where(inArray(LedgerTransactionEntriesTable.organizationId, ids));
			await db
				.delete(LedgerTransactionsTable)
				.where(inArray(LedgerTransactionsTable.organizationId, ids));
			await db.delete(LedgerAccountsTable).where(inArray(LedgerAccountsTable.organizationId, ids));
			await db.delete(LedgersTable).where(inArray(LedgersTable.organizationId, ids));
			await db.delete(OrganizationsTable).where(inArray(OrganizationsTable.id, ids));
		} finally {
			await runtime.dispose();
		}
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates, decodes, and reads a Settlement by Organization while ignoring Ledger scope", async () => {
		const record = settlement(context, {
			description: "Settlement",
			externalReference: "external-1",
			effectiveAtUpperBound: DateTime.fromISO("2026-08-01T00:00:00.000Z", { zone: "utc" }),
			metadata: { source: "test" },
		});
		const created = await runRepo(repository => repository.createSettlement(record));
		const loaded = await runRepo(repository =>
			repository.getSettlement(context.organizationId, created.id)
		);

		expect(loaded).toMatchObject({
			id: created.id,
			description: "Settlement",
			externalReference: "external-1",
			metadata: { source: "test" },
		});
		expect(loaded.effectiveAtUpperBound?.toISO()).toBe("2026-08-01T00:00:00.000Z");
		expect(otherLedger.ledgerId).not.toEqual(context.ledgerId);
	});

	it("enforces Organization isolation on item methods", async () => {
		const created = await runRepo(repository => repository.createSettlement(settlement(context)));

		await expect(
			runRepo(repository => repository.getSettlement(otherOrganization.organizationId, created.id))
		).rejects.toThrow(NotFoundError);
	});

	it("translates foreign-key and no-self-settlement constraint failures", async () => {
		await expect(
			runRepo(repository =>
				repository.createSettlement(settlement(context, { contraAccountId: context.settledAccountId }))
			)
		).rejects.toThrow(ConflictError);

		await expect(
			runRepo(repository =>
				repository.createSettlement(settlement(context, { settledAccountId: newLedgerAccountID() }))
			)
		).rejects.toThrow(NotFoundError);
	});

	it("lists only the requested Organization and Ledger in descending Created Time order", async () => {
		const listContext = await createContext();
		const listOtherLedger = await createContext(listContext.organizationId, false);
		const older = settlement(listContext, {
			created: DateTime.fromISO("2026-01-01T00:00:00.000Z", { zone: "utc" }),
		});
		const newer = settlement(listContext, {
			created: DateTime.fromISO("2026-02-01T00:00:00.000Z", { zone: "utc" }),
		});
		await runRepo(repository =>
			Effect.all([
				repository.createSettlement(older),
				repository.createSettlement(newer),
				repository.createSettlement(settlement(listOtherLedger)),
				repository.createSettlement(settlement(otherOrganization)),
			])
		);

		const page = await runRepo(repository =>
			repository.listSettlements(listContext.organizationId, listContext.ledgerId, 0, 2)
		);
		expect(page.map(item => item.id.toString())).toEqual([newer.id.toString(), older.id.toString()]);
		expect(
			await runRepo(repository =>
				repository.listSettlements(listContext.organizationId, listContext.ledgerId, 1, 1)
			)
		).toHaveLength(1);
	});

	it("allows full writes and deletes only while drafting", async () => {
		const original = await runRepo(repository =>
			repository.createSettlement(settlement(context, { description: "Original" }))
		);
		const replacementCreated = DateTime.fromISO("2025-01-01T00:00:00.000Z", { zone: "utc" });
		const updated = await runRepo(repository =>
			repository.updateSettlement(
				new LedgerAccountSettlementEntity({
					...original,
					description: "Updated",
					created: replacementCreated,
				})
			)
		);
		expect(updated.description).toBe("Updated");
		expect(updated.created).toEqual(replacementCreated);

		await runRepo(repository =>
			repository.updateStatus(context.organizationId, original.id, "processing")
		);
		await expect(runRepo(repository => repository.updateSettlement(updated))).rejects.toThrow(
			ConflictError
		);
		await expect(
			runRepo(repository => repository.deleteSettlement(context.organizationId, original.id))
		).rejects.toThrow(ConflictError);
	});

	it("captures update timestamps when mutation Effects execute", async () => {
		const original = await runRepo(repository =>
			repository.createSettlement(settlement(context, { description: "Original" }))
		);
		const repository = await runtime.runPromise(LedgerAccountSettlementRepoTag);
		const constructionTime = new Date("2026-08-29T12:00:00.000Z");
		const updateTime = new Date("2026-08-29T12:01:00.000Z");
		const statusTime = new Date("2026-08-29T12:02:00.000Z");
		vi.useFakeTimers({ toFake: ["Date"] });

		vi.setSystemTime(constructionTime);
		const update = repository.updateSettlement(original);
		vi.setSystemTime(updateTime);
		expect((await runtime.runPromise(update)).updated.toJSDate()).toEqual(updateTime);

		const statusUpdate = repository.updateStatus(context.organizationId, original.id, "processing");
		vi.setSystemTime(statusTime);
		expect((await runtime.runPromise(statusUpdate)).updated.toJSDate()).toEqual(statusTime);
	});

	it("validates Entry eligibility and retains links during Pending rollback", async () => {
		const record = await runRepo(repository => repository.createSettlement(settlement(context)));
		const transactionId = newLedgerTransactionID();
		const eligibleId = newLedgerTransactionEntryID();
		const wrongAccountId = newLedgerTransactionEntryID();
		await runTransactionRepo(repository =>
			LedgerTransaction.fromCreateRequest(
				transactionId,
				context.organizationId,
				context.ledgerId,
				{
					status: "pending",
					ledgerEntries: [
						{
							accountId: context.settledAccountId.toString(),
							direction: "debit",
							amount: 125,
							currencyCode: "USD",
						},
						{
							accountId: context.contraAccountId.toString(),
							direction: "credit",
							amount: 125,
							currencyCode: "USD",
						},
					],
				},
				DateTime.utc(),
				[eligibleId, wrongAccountId]
			).pipe(Effect.flatMap(transaction => repository.createTransaction(transaction)))
		);

		await expect(
			runRepo(repository =>
				repository.addEntriesToSettlement(context.organizationId, record.id, [
					wrongAccountId.toString(),
				])
			)
		).rejects.toThrow(ConflictError);
		await expect(
			runRepo(repository =>
				repository.addEntriesToSettlement(context.organizationId, record.id, [
					newLedgerTransactionEntryID().toString(),
				])
			)
		).rejects.toThrow(NotFoundError);

		await expect(
			runRepo(repository =>
				repository.addEntriesToSettlement(context.organizationId, record.id, [eligibleId.toString()])
			)
		).rejects.toThrow(ConflictError);
		await runTransactionRepo(repository =>
			repository.postTransaction(
				context.organizationId,
				context.ledgerId,
				transactionId,
				DateTime.utc()
			)
		);

		await runRepo(repository =>
			repository.addEntriesToSettlement(context.organizationId, record.id, [eligibleId.toString()])
		);
		expect(await runRepo(repository => repository.getEntryIds(record.id))).toEqual([
			eligibleId.toString(),
		]);
		expect(await runRepo(repository => repository.calculateAmount(record.id))).toBe(125);
		await expect(
			runRepo(repository =>
				repository.addEntriesToSettlement(context.organizationId, record.id, [eligibleId.toString()])
			)
		).rejects.toThrow(ConflictError);

		await runRepo(repository =>
			repository.updateStatus(context.organizationId, record.id, "pending")
		);
		await runRepo(repository =>
			repository.updateStatus(context.organizationId, record.id, "drafting")
		);
		expect(await runRepo(repository => repository.getEntryIds(record.id))).toEqual([
			eligibleId.toString(),
		]);
		await runRepo(repository =>
			repository.removeEntriesFromSettlement(context.organizationId, record.id, [
				eligibleId.toString(),
			])
		);
		expect(await runRepo(repository => repository.calculateAmount(record.id))).toBe(0);
	});

	it("rejects Entry mutations once the Settlement is no longer drafting", async () => {
		const record = await runRepo(repository => repository.createSettlement(settlement(context)));
		await runRepo(repository =>
			repository.updateStatus(context.organizationId, record.id, "processing")
		);

		await expect(
			runRepo(repository => repository.addEntriesToSettlement(context.organizationId, record.id, []))
		).rejects.toThrow(ConflictError);
		await expect(
			runRepo(repository =>
				repository.removeEntriesFromSettlement(context.organizationId, record.id, [])
			)
		).rejects.toThrow(ConflictError);
	});

	it("updates status and reports a missing Settlement", async () => {
		const record = await runRepo(repository => repository.createSettlement(settlement(context)));
		expect(
			await runRepo(repository =>
				repository.updateStatus(context.organizationId, record.id, "processing")
			)
		).toMatchObject({ status: "processing" });
		await expect(
			runRepo(repository =>
				repository.updateStatus(context.organizationId, newLedgerAccountSettlementID(), "processing")
			)
		).rejects.toThrow(NotFoundError);
	});
});
