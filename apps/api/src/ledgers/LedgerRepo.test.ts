import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { TypeID } from "typeid-js";
import { afterAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import { OrganizationNotFound } from "@/organizations";
import { LedgerRepo as LegacyLedgerRepo } from "@/repo/LedgerRepo";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import { LedgerAccountsTable, LedgersTable, OrganizationsTable } from "@/repo/schema";
import type { LedgerWrite } from "./domain/Ledger";
import {
	LedgerHasDependents,
	LedgerPersistenceDecodingFailure,
	LedgerPersistenceFailure,
} from "./LedgerErrors";
import { type LedgerRepo, LedgerRepoTag, ledgerRepoLayer } from "./LedgerRepo";

const newOrganizationId = (): OrgID => new TypeID("org");
const newLedgerId = (): LedgerID => new TypeID("lgr");

describe("LedgerRepoLive", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const runtime: ManagedRuntime.ManagedRuntime<LedgerRepo | Database, never> = ManagedRuntime.make(
		ledgerRepoLayer.pipe(Layer.provideMerge(databaseLayer))
	);
	const organizationIds = new Set<string>();

	const runRepo = <A, E>(use: (repository: LedgerRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(LedgerRepoTag.pipe(Effect.flatMap(use)));
	const runDatabase = <A>(use: (database: Database) => Promise<A>) =>
		runtime.runPromise(
			DatabaseTag.pipe(Effect.flatMap(database => Effect.promise(() => use(database))))
		);

	const createOrganization = async (): Promise<OrgID> => {
		const id = newOrganizationId();
		organizationIds.add(id.toString());
		await runDatabase(database =>
			database.db
				.insert(OrganizationsTable)
				.values({ id: id.toString(), name: `Ledger test ${id.toString()}` })
		);
		return id;
	};

	const insertLedger = (
		organizationId: OrgID,
		options: {
			readonly id?: string;
			readonly name?: string;
			readonly metadata?: string;
		} = {}
	) =>
		runDatabase(database =>
			database.db.insert(LedgersTable).values({
				id: options.id ?? newLedgerId().toString(),
				organizationId: organizationId.toString(),
				name: options.name ?? "Ledger",
				metadata: options.metadata,
			})
		);
	const ledgerWrite = (
		organizationId: OrgID,
		overrides: Partial<LedgerWrite> = {}
	): LedgerWrite => ({
		id: newLedgerId(),
		organizationId,
		name: "Ledger",
		...overrides,
	});
	const getLegacyLedger = (organizationId: OrgID, ledgerId: LedgerID) =>
		runDatabase(database => new LegacyLedgerRepo(database.db).getLedger(organizationId, ledgerId));

	afterAll(async () => {
		try {
			await runDatabase(async database => {
				for (const organizationId of organizationIds) {
					await database.db
						.delete(LedgerAccountsTable)
						.where(eq(LedgerAccountsTable.organizationId, organizationId));
					await database.db.delete(LedgersTable).where(eq(LedgersTable.organizationId, organizationId));
					await database.db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, organizationId));
				}
			});
		} finally {
			await runtime.dispose();
		}
	});

	it("orders lists by Ledger ID and paginates in PostgreSQL", async () => {
		const organizationId = await createOrganization();
		const ids = [newLedgerId(), newLedgerId(), newLedgerId()];
		for (const id of ids) await insertLedger(organizationId, { id: id.toString() });

		const all = await runRepo(repository =>
			repository.list(organizationId, { offset: 0, limit: 100 })
		);
		const expected = ids.map(id => id.toString()).sort();
		expect(all.map(ledger => ledger.id.toString())).toEqual(expected);

		const page = await runRepo(repository =>
			repository.list(organizationId, { offset: 1, limit: 1 })
		);
		expect(page.map(ledger => ledger.id.toString())).toEqual(expected.slice(1, 2));
	});

	it("enforces Organization isolation for list and get", async () => {
		const ownerId = await createOrganization();
		const otherId = await createOrganization();
		const ledgerId = newLedgerId();
		await insertLedger(ownerId, { id: ledgerId.toString(), name: "Owned" });
		await insertLedger(otherId, { name: "Other" });

		const listed = await runRepo(repository => repository.list(ownerId, { offset: 0, limit: 100 }));
		expect(listed.map(ledger => ledger.name)).toEqual(["Owned"]);
		const found = await runRepo(repository => repository.get(ownerId, ledgerId));
		expect(Option.getOrUndefined(found)?.name).toBe("Owned");
		expect(await runRepo(repository => repository.get(otherId, ledgerId))).toEqual(Option.none());
	});

	it("returns explicit absence for a missing Ledger", async () => {
		const organizationId = await createOrganization();

		expect(await runRepo(repository => repository.get(organizationId, newLedgerId()))).toEqual(
			Option.none()
		);
	});

	it("decodes string-valued metadata", async () => {
		const organizationId = await createOrganization();
		const ledgerId = newLedgerId();
		await insertLedger(organizationId, {
			id: ledgerId.toString(),
			metadata: JSON.stringify({ externalId: "book-42" }),
		});

		const found = await runRepo(repository => repository.get(organizationId, ledgerId));
		expect(Option.getOrUndefined(found)?.metadata).toEqual({ externalId: "book-42" });
	});

	it.each([
		["invalid Ledger ID", "not-a-ledger-id"],
		["malformed JSON", "{"],
		["non-object JSON", "[]"],
		["non-string metadata value", JSON.stringify({ externalId: 42 })],
	] as const)("maps %s to LedgerPersistenceDecodingFailure", async (scenario, value) => {
		const organizationId = await createOrganization();
		await insertLedger(
			organizationId,
			scenario === "invalid Ledger ID" ? { id: value } : { metadata: value }
		);

		const error = await runRepo(repository =>
			Effect.flip(repository.list(organizationId, { offset: 0, limit: 100 }))
		);
		expect(error).toBeInstanceOf(LedgerPersistenceDecodingFailure);
	});

	it("creates duplicate names with PostgreSQL timestamps", async () => {
		const organizationId = await createOrganization();
		const first = await runRepo(repository => repository.create(ledgerWrite(organizationId)));
		const second = await runRepo(repository => repository.create(ledgerWrite(organizationId)));

		expect(first.id).not.toBe(second.id);
		expect(first.created).toBeInstanceOf(Date);
		expect(first.updated).toEqual(first.created);
	});

	it("maps a missing parent Organization to OrganizationNotFound", async () => {
		const organizationId = newOrganizationId();
		const error = await runRepo(repository =>
			Effect.flip(repository.create(ledgerWrite(organizationId)))
		);

		expect(error).toBeInstanceOf(OrganizationNotFound);
		expect(error.organizationId).toBe(organizationId.toString());
	});

	it("maps a generated Ledger ID collision to LedgerPersistenceFailure", async () => {
		const organizationId = await createOrganization();
		const write = ledgerWrite(organizationId);
		await runRepo(repository => repository.create(write));

		const error = await runRepo(repository => Effect.flip(repository.create(write)));
		expect(error).toBeInstanceOf(LedgerPersistenceFailure);
	});

	it("replaces mutable fields while preserving created and legacy Currency", async () => {
		const organizationId = await createOrganization();
		const created = await runRepo(repository =>
			repository.create(
				ledgerWrite(organizationId, {
					name: "Before",
					description: "Remove me",
					metadata: { externalId: "book-42" },
				})
			)
		);
		const previousUpdated = new Date(0);
		await runDatabase(database =>
			database.db
				.update(LedgersTable)
				.set({ updated: previousUpdated })
				.where(eq(LedgersTable.id, created.id.toString()))
		);

		const updated = await runRepo(repository =>
			repository.update(
				ledgerWrite(organizationId, {
					id: created.id,
					name: "After",
				})
			)
		);
		const value = Option.getOrUndefined(updated);
		expect(value).toMatchObject({ name: "After" });
		expect(value?.description).toBeUndefined();
		expect(value?.metadata).toBeUndefined();
		expect(value?.created).toEqual(created.created);
		expect(value?.updated).not.toEqual(previousUpdated);
	});

	it("returns absence when update is missing or crosses Organizations and never inserts", async () => {
		const ownerId = await createOrganization();
		const otherId = await createOrganization();
		const missing = ledgerWrite(ownerId);
		expect(await runRepo(repository => repository.update(missing))).toEqual(Option.none());
		expect(await runRepo(repository => repository.get(ownerId, missing.id))).toEqual(Option.none());

		const created = await runRepo(repository =>
			repository.create(ledgerWrite(ownerId, { name: "Owned" }))
		);
		const crossed = ledgerWrite(otherId, { id: created.id, name: "Crossed" });
		expect(await runRepo(repository => repository.update(crossed))).toEqual(Option.none());
		expect((await getLegacyLedger(ownerId, created.id)).name).toBe("Owned");
		expect(await runRepo(repository => repository.get(otherId, created.id))).toEqual(Option.none());
	});

	it("returns absence when delete is missing or crosses Organizations", async () => {
		const ownerId = await createOrganization();
		const otherId = await createOrganization();
		const missingId = newLedgerId();
		expect(await runRepo(repository => repository.delete(ownerId, missingId))).toEqual(Option.none());

		const created = await runRepo(repository => repository.create(ledgerWrite(ownerId)));
		expect(await runRepo(repository => repository.delete(otherId, created.id))).toEqual(
			Option.none()
		);
		expect(Option.isSome(await runRepo(repository => repository.get(ownerId, created.id)))).toBe(
			true
		);
		expect(Option.isSome(await runRepo(repository => repository.delete(ownerId, created.id)))).toBe(
			true
		);
	});

	it("deletes without decoding persisted Ledger fields", async () => {
		const organizationId = await createOrganization();
		const ledgerId = newLedgerId();
		await insertLedger(organizationId, { id: ledgerId.toString(), metadata: "{" });

		const deleted = await runRepo(repository => repository.delete(organizationId, ledgerId));

		expect(Option.isSome(deleted)).toBe(true);
		expect(await runRepo(repository => repository.get(organizationId, ledgerId))).toEqual(
			Option.none()
		);
	});

	it("maps a real dependent Ledger Account to LedgerHasDependents", async () => {
		const organizationId = await createOrganization();
		const created = await runRepo(repository => repository.create(ledgerWrite(organizationId)));
		await runDatabase(database =>
			database.db.insert(LedgerAccountsTable).values({
				id: new TypeID("lat").toString(),
				organizationId: organizationId.toString(),
				ledgerId: created.id.toString(),
				name: "Dependent account",
				normalBalance: "debit",
				currencyCode: "USD",
				minorUnitExponent: 2,
			})
		);

		const error = await runRepo(repository =>
			Effect.flip(repository.delete(organizationId, created.id))
		);
		expect(error).toBeInstanceOf(LedgerHasDependents);
	});
});
