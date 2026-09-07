import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import { OrganizationNotFound } from "@/domains/organizations";
import { newLedgerAccountID, newLedgerID, newOrgID, type OrgID } from "@/lib/ids";
import { LedgersTable } from "@/db/schema";
import {
	type OrganizationRepo,
	OrganizationRepoTag,
	organizationRepoLayer,
} from "@/domains/organizations/OrganizationRepo";
import { Organization } from "@/domains/organizations/Organization";
import {
	type LedgerAccountRepo,
	LedgerAccountRepoTag,
	ledgerAccountRepoLayer,
} from "./accounts/LedgerAccountRepo";
import { LedgerAccount } from "./accounts/LedgerAccount";
import { Ledger } from "./Ledger";
import {
	LedgerHasDependents,
	LedgerPersistenceDecodingFailure,
	LedgerPersistenceFailure,
} from "./LedgerErrors";
import { type LedgerRepo, LedgerRepoTag, ledgerRepoLayer } from "./LedgerRepo";

const ledgerWrite = (
	organizationId: OrgID,
	overrides: Partial<Pick<Ledger, "id" | "name" | "description" | "metadata">> = {}
): Ledger =>
	Ledger.fromRequest(overrides.id ?? newLedgerID(), organizationId, {
		name: overrides.name ?? "Ledger",
		description: overrides.description,
		metadata: overrides.metadata,
	});

describe("LedgerRepoLive", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const reposLayer = Layer.mergeAll(
		ledgerAccountRepoLayer,
		ledgerRepoLayer,
		organizationRepoLayer
	).pipe(Layer.provideMerge(databaseLayer));
	type TestRepos = LedgerAccountRepo | Database | LedgerRepo | OrganizationRepo;
	const runtime: ManagedRuntime.ManagedRuntime<TestRepos, never> = ManagedRuntime.make(reposLayer);
	const organizationIds = new Set<OrgID>();

	let repository: LedgerRepo;
	let accountRepository: LedgerAccountRepo;
	let organizationRepository: OrganizationRepo;
	let database: Database;

	beforeAll(async () => {
		repository = await runtime.runPromise(LedgerRepoTag);
		accountRepository = await runtime.runPromise(LedgerAccountRepoTag);
		organizationRepository = await runtime.runPromise(OrganizationRepoTag);
		database = await runtime.runPromise(DatabaseTag);
	});

	const createOrganization = async (): Promise<OrgID> => {
		const id = newOrgID();
		organizationIds.add(id);
		await runtime.runPromise(
			organizationRepository.createOrganization(
				Organization.fromRequest(id, { name: `Ledger test ${id.toString()}` })
			)
		);
		return id;
	};

	afterAll(async () => {
		try {
			for (const organizationId of organizationIds) {
				const ledgers = await runtime.runPromise(
					repository.listLedgers(organizationId, { offset: 0, limit: 100 })
				);
				for (const ledger of ledgers) {
					const accounts = await runtime.runPromise(
						accountRepository.listAccounts(organizationId, ledger.id, { offset: 0, limit: 100 })
					);
					for (const account of accounts) {
						await runtime.runPromise(
							accountRepository.deleteAccount(organizationId, ledger.id, account.id)
						);
					}
					await runtime.runPromise(repository.deleteLedger(organizationId, ledger.id));
				}
				await runtime.runPromise(organizationRepository.deleteOrganization(organizationId));
			}
		} finally {
			await runtime.dispose();
		}
	});

	it("orders lists by Ledger ID and paginates in PostgreSQL", async () => {
		const organizationId = await createOrganization();
		const ids = [newLedgerID(), newLedgerID(), newLedgerID()];
		for (const id of ids) {
			await runtime.runPromise(repository.createLedger(ledgerWrite(organizationId, { id })));
		}

		const all = await runtime.runPromise(
			repository.listLedgers(organizationId, { offset: 0, limit: 100 })
		);
		const expected = ids.map(id => id.toString()).sort();
		expect(all.map(ledger => ledger.id.toString())).toEqual(expected);

		const page = await runtime.runPromise(
			repository.listLedgers(organizationId, { offset: 1, limit: 1 })
		);
		expect(page.map(ledger => ledger.id.toString())).toEqual(expected.slice(1, 2));
	});

	it("enforces Organization isolation for list and get", async () => {
		const ownerId = await createOrganization();
		const otherId = await createOrganization();
		const ledgerId = newLedgerID();
		await runtime.runPromise(
			repository.createLedger(ledgerWrite(ownerId, { id: ledgerId, name: "Owned" }))
		);
		await runtime.runPromise(repository.createLedger(ledgerWrite(otherId, { name: "Other" })));

		const listed = await runtime.runPromise(
			repository.listLedgers(ownerId, { offset: 0, limit: 100 })
		);
		expect(listed.map(ledger => ledger.name)).toEqual(["Owned"]);
		const found = await runtime.runPromise(repository.getLedger(ownerId, ledgerId));
		expect(Option.getOrUndefined(found)?.name).toBe("Owned");
		expect(await runtime.runPromise(repository.getLedger(otherId, ledgerId))).toEqual(Option.none());
	});

	it("returns explicit absence for a missing Ledger", async () => {
		const organizationId = await createOrganization();

		expect(await runtime.runPromise(repository.getLedger(organizationId, newLedgerID()))).toEqual(
			Option.none()
		);
	});

	it.each([
		{
			label: "stored optional values",
			description: "Primary book",
			metadata: { externalId: "book-42" },
		},
		{ label: "omitted optional values", description: undefined, metadata: undefined },
	])("creates and decodes $label", async ({ description, metadata }) => {
		const organizationId = await createOrganization();
		const ledgerId = newLedgerID();
		const record = ledgerWrite(organizationId, {
			id: ledgerId,
			description,
			metadata,
		});
		await runtime.runPromise(repository.createLedger(record));

		const found = await runtime.runPromise(repository.getLedger(organizationId, ledgerId));
		const value = Option.getOrThrow(found);
		expect(value.description).toBe(description);
		expect(value.metadata).toEqual(metadata);
		expect(record.toCreateRow().created).toBeInstanceOf(Date);
		expect(record.toCreateRow().updated).toBeInstanceOf(Date);
		expect(DateTime.isDateTime(value.created)).toBe(true);
		expect(DateTime.isDateTime(value.updated)).toBe(true);
		expect(value.created).toEqual(record.created);
		expect(value.updated).toEqual(record.updated);
	});

	it("returns a typed decoding failure for an invalid timestamp", async () => {
		const organizationId = newOrgID();
		const row = ledgerWrite(organizationId).toCreateRow();
		const error = await Effect.runPromise(
			Effect.flip(Ledger.fromRow({ ...row, created: new Date(Number.NaN) }))
		);

		expect(error).toBeInstanceOf(LedgerPersistenceDecodingFailure);
	});

	it("creates duplicate names with application timestamps", async () => {
		const organizationId = await createOrganization();
		const firstRecord = ledgerWrite(organizationId);
		const secondRecord = ledgerWrite(organizationId);
		const first = await runtime.runPromise(repository.createLedger(firstRecord));
		const second = await runtime.runPromise(repository.createLedger(secondRecord));

		expect(first.id).not.toBe(second.id);
		expect(first.created).toEqual(firstRecord.created);
		expect(first.updated).toEqual(firstRecord.updated);
		expect(second.created).toEqual(secondRecord.created);
		expect(second.updated).toEqual(secondRecord.updated);
	});

	it("maps a missing parent Organization to OrganizationNotFound", async () => {
		const organizationId = newOrgID();
		const error = await runtime.runPromise(
			Effect.flip(repository.createLedger(ledgerWrite(organizationId)))
		);

		expect(error).toBeInstanceOf(OrganizationNotFound);
	});

	it("maps a generated Ledger ID collision to LedgerPersistenceFailure", async () => {
		const organizationId = await createOrganization();
		const write = ledgerWrite(organizationId);
		await runtime.runPromise(repository.createLedger(write));

		const error = await runtime.runPromise(Effect.flip(repository.createLedger(write)));
		expect(error).toBeInstanceOf(LedgerPersistenceFailure);
	});

	it.each([
		{
			label: "replaces",
			description: "New description",
			metadata: { externalId: "book-99" },
		},
		{ label: "clears", description: undefined, metadata: undefined },
	])(
		"$label optional mutable fields while preserving created",
		async ({ description, metadata }) => {
			const organizationId = await createOrganization();
			const created = await runtime.runPromise(
				repository.createLedger(
					ledgerWrite(organizationId, {
						name: "Before",
						description: "Remove me",
						metadata: { externalId: "book-42" },
					})
				)
			);
			const replacement = ledgerWrite(organizationId, {
				id: created.id,
				name: "After",
				description,
				metadata,
			});
			const updated = await runtime.runPromise(repository.updateLedger(replacement));
			const value = Option.getOrUndefined(updated);
			expect(value).toMatchObject({ name: "After" });
			expect(value?.description).toBe(description);
			expect(value?.metadata).toEqual(metadata);
			expect(value?.created).toEqual(created.created);
			expect(value?.updated).toEqual(replacement.updated);
		}
	);

	it("returns absence when update is missing or crosses Organizations and never inserts", async () => {
		const ownerId = await createOrganization();
		const otherId = await createOrganization();
		const missing = ledgerWrite(ownerId);
		expect(await runtime.runPromise(repository.updateLedger(missing))).toEqual(Option.none());
		expect(await runtime.runPromise(repository.getLedger(ownerId, missing.id))).toEqual(
			Option.none()
		);

		const created = await runtime.runPromise(
			repository.createLedger(ledgerWrite(ownerId, { name: "Owned" }))
		);
		const crossed = ledgerWrite(otherId, { id: created.id, name: "Crossed" });
		expect(await runtime.runPromise(repository.updateLedger(crossed))).toEqual(Option.none());
		expect(
			Option.getOrUndefined(await runtime.runPromise(repository.getLedger(ownerId, created.id)))?.name
		).toBe("Owned");
		expect(await runtime.runPromise(repository.getLedger(otherId, created.id))).toEqual(
			Option.none()
		);
	});

	it("returns absence when delete is missing or crosses Organizations", async () => {
		const ownerId = await createOrganization();
		const otherId = await createOrganization();
		const missingId = newLedgerID();
		expect(await runtime.runPromise(repository.deleteLedger(ownerId, missingId))).toEqual(
			Option.none()
		);

		const created = await runtime.runPromise(repository.createLedger(ledgerWrite(ownerId)));
		expect(await runtime.runPromise(repository.deleteLedger(otherId, created.id))).toEqual(
			Option.none()
		);
		expect(Option.isSome(await runtime.runPromise(repository.getLedger(ownerId, created.id)))).toBe(
			true
		);
		expect(
			Option.isSome(await runtime.runPromise(repository.deleteLedger(ownerId, created.id)))
		).toBe(true);
	});

	it("maps a real dependent Ledger Account to LedgerHasDependents", async () => {
		const organizationId = await createOrganization();
		const created = await runtime.runPromise(repository.createLedger(ledgerWrite(organizationId)));
		await runtime.runPromise(
			accountRepository.createAccount(
				LedgerAccount.fromCreateRequest(newLedgerAccountID(), organizationId, created.id, {
					name: "Dependent account",
					normalBalance: "debit",
					currencyCode: "USD",
				})
			)
		);

		const error = await runtime.runPromise(
			Effect.flip(repository.deleteLedger(organizationId, created.id))
		);
		expect(error).toBeInstanceOf(LedgerHasDependents);
	});

	it.each([
		{ label: "invalid serialized metadata", metadata: "{" },
		{
			label: "non-string metadata value",
			metadata: JSON.stringify({ externalId: 42 }),
		},
	])("returns a typed decoding failure for $label", async testCase => {
		const organizationId = await createOrganization();
		const id = newLedgerID();
		const db = database.db;
		const row = ledgerWrite(organizationId).toCreateRow();
		await db
			.insert(LedgersTable)
			.values({ ...row, id: id.toUUID(), metadata: testCase.metadata ?? row.metadata });

		try {
			const error = await runtime.runPromise(Effect.flip(repository.getLedger(organizationId, id)));
			expect(error).toBeInstanceOf(LedgerPersistenceDecodingFailure);
		} finally {
			await db.delete(LedgersTable).where(eq(LedgersTable.id, id.toUUID()));
		}
	});
});
