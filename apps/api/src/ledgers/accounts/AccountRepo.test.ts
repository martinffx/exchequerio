import { eq, inArray } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { TypeID } from "typeid-js";
import { afterAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import { LedgerNotFound, makeCurrency } from "@/ledgers";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import {
	LedgerAccountBalanceMonitorsTable,
	LedgerAccountsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/repo/schema";
import {
	AccountHasDependents,
	AccountNameConflict,
	AccountPersistenceDecodingFailure,
	AccountPersistenceFailure,
	AccountVersionConflict,
} from "./AccountErrors";
import { type AccountRepo, AccountRepoTag, accountRepoLayer } from "./AccountRepo";
import type { AccountCreate } from "./domain/Account";

const newOrganizationId = (): OrgID => new TypeID("org");
const newLedgerId = (): LedgerID => new TypeID("lgr");
const newAccountId = (): LedgerAccountID => new TypeID("lat");

describe("AccountRepoLive", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const runtime: ManagedRuntime.ManagedRuntime<AccountRepo | Database, never> = ManagedRuntime.make(
		accountRepoLayer.pipe(Layer.provideMerge(databaseLayer))
	);
	const organizationIds = new Set<string>();

	const runRepo = <A, E>(use: (repository: AccountRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(AccountRepoTag.pipe(Effect.flatMap(use)));
	const runDatabase = <A>(use: (database: Database) => Promise<A>) =>
		runtime.runPromise(
			DatabaseTag.pipe(Effect.flatMap(database => Effect.promise(() => use(database))))
		);

	const createOrganizationAndLedger = async (): Promise<{
		organizationId: OrgID;
		ledgerId: LedgerID;
	}> => {
		const organizationId = newOrganizationId();
		const ledgerId = newLedgerId();
		organizationIds.add(organizationId.toString());
		await runDatabase(async database => {
			await database.db.insert(OrganizationsTable).values({
				id: organizationId.toString(),
				name: `Account test ${organizationId.toString()}`,
			});
			await database.db.insert(LedgersTable).values({
				id: ledgerId.toString(),
				organizationId: organizationId.toString(),
				name: "Ledger",
			});
		});
		return { organizationId, ledgerId };
	};

	const accountCreate = (
		organizationId: OrgID,
		ledgerId: LedgerID,
		overrides: Partial<AccountCreate> = {}
	): AccountCreate => ({
		id: newAccountId(),
		organizationId,
		ledgerId,
		name: "Cash",
		normalBalance: "debit",
		currency: makeCurrency("USD", 2),
		...overrides,
	});

	afterAll(async () => {
		try {
			await runDatabase(async database => {
				for (const organizationId of organizationIds) {
					const accounts = await database.db
						.select({ id: LedgerAccountsTable.id })
						.from(LedgerAccountsTable)
						.where(eq(LedgerAccountsTable.organizationId, organizationId));
					if (accounts.length > 0) {
						await database.db.delete(LedgerAccountBalanceMonitorsTable).where(
							inArray(
								LedgerAccountBalanceMonitorsTable.accountId,
								accounts.map(account => account.id)
							)
						);
					}
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

	it("orders by creation descending with Account ID as a stable tie-breaker", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const ids = [newAccountId(), newAccountId(), newAccountId()].sort((left, right) =>
			left.toString().localeCompare(right.toString())
		);
		const newest = new Date("2026-08-09T11:00:00.000Z");
		const oldest = new Date("2026-08-09T10:00:00.000Z");
		await runDatabase(database =>
			database.db.insert(LedgerAccountsTable).values([
				{
					id: ids[1].toString(),
					organizationId: organizationId.toString(),
					ledgerId: ledgerId.toString(),
					name: "B",
					normalBalance: "debit",
					currencyCode: "USD",
					minorUnitExponent: 2,
					created: newest,
				},
				{
					id: ids[0].toString(),
					organizationId: organizationId.toString(),
					ledgerId: ledgerId.toString(),
					name: "A",
					normalBalance: "debit",
					currencyCode: "USD",
					minorUnitExponent: 2,
					created: newest,
				},
				{
					id: ids[2].toString(),
					organizationId: organizationId.toString(),
					ledgerId: ledgerId.toString(),
					name: "C",
					normalBalance: "debit",
					currencyCode: "USD",
					minorUnitExponent: 2,
					created: oldest,
				},
			])
		);

		const accounts = await runRepo(repository =>
			repository.list(organizationId, ledgerId, { offset: 0, limit: 100 })
		);
		expect(accounts.map(account => account.id.toString())).toEqual([
			ids[0].toString(),
			ids[1].toString(),
			ids[2].toString(),
		]);
	});

	it("enforces Organization and Ledger scope", async () => {
		const owner = await createOrganizationAndLedger();
		const other = await createOrganizationAndLedger();
		const created = await runRepo(repository =>
			repository.create(accountCreate(owner.organizationId, owner.ledgerId))
		);

		expect(
			await runRepo(repository => repository.get(owner.organizationId, owner.ledgerId, created.id))
		).toSatisfy(Option.isSome);
		expect(
			await runRepo(repository => repository.get(other.organizationId, owner.ledgerId, created.id))
		).toEqual(Option.none());
		expect(
			await runRepo(repository => repository.get(owner.organizationId, other.ledgerId, created.id))
		).toEqual(Option.none());
	});

	it("creates at lockVersion 1 and decodes Account Currency", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const created = await runRepo(repository =>
			repository.create(
				accountCreate(organizationId, ledgerId, {
					currency: makeCurrency("US0378331005", 4),
					metadata: { externalId: "cash-42" },
				})
			)
		);

		expect(created.lockVersion).toBe(1);
		expect(created.currency).toEqual({ code: "US0378331005", minorUnitExponent: 4 });
		expect(created.metadata).toEqual({ externalId: "cash-42" });
		expect(created.balances.every(balance => balance.amount === 0)).toBe(true);
	});

	it("maps duplicate names but not ID collisions to their public Conflict", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const first = accountCreate(organizationId, ledgerId);
		await runRepo(repository => repository.create(first));

		const duplicateName = await runRepo(repository =>
			Effect.flip(repository.create(accountCreate(organizationId, ledgerId)))
		);
		expect(duplicateName).toBeInstanceOf(AccountNameConflict);

		const idCollision = await runRepo(repository =>
			Effect.flip(
				repository.create(accountCreate(organizationId, ledgerId, { id: first.id, name: "Other" }))
			)
		);
		expect(idCollision).toBeInstanceOf(AccountPersistenceFailure);
	});

	it("maps a missing or cross-Organization Ledger to LedgerNotFound", async () => {
		const owner = await createOrganizationAndLedger();
		const other = await createOrganizationAndLedger();
		const error = await runRepo(repository =>
			Effect.flip(repository.create(accountCreate(other.organizationId, owner.ledgerId)))
		);

		expect(error).toBeInstanceOf(LedgerNotFound);
	});

	it("allows the first update and rejects a stale version", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const created = await runRepo(repository =>
			repository.create(accountCreate(organizationId, ledgerId))
		);
		const updated = await runRepo(repository =>
			repository.update({
				id: created.id,
				organizationId,
				ledgerId,
				name: "Operating Cash",
				expectedLockVersion: created.lockVersion,
			})
		);

		expect(updated.name).toBe("Operating Cash");
		expect(updated.lockVersion).toBe(2);
		const error = await runRepo(repository =>
			Effect.flip(
				repository.update({
					id: created.id,
					organizationId,
					ledgerId,
					name: "Stale",
					expectedLockVersion: created.lockVersion,
				})
			)
		);
		expect(error).toBeInstanceOf(AccountVersionConflict);
	});

	it("maps invalid persisted metadata to a decoding failure", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		await runDatabase(database =>
			database.db.insert(LedgerAccountsTable).values({
				id: newAccountId().toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				name: "Invalid metadata",
				normalBalance: "debit",
				currencyCode: "USD",
				minorUnitExponent: 2,
				metadata: "{",
			})
		);

		const error = await runRepo(repository =>
			Effect.flip(repository.list(organizationId, ledgerId, { offset: 0, limit: 100 }))
		);
		expect(error).toBeInstanceOf(AccountPersistenceDecodingFailure);
	});

	it("maps dependent deletion and deletes an unused Account", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const dependent = await runRepo(repository =>
			repository.create(accountCreate(organizationId, ledgerId, { name: "Dependent" }))
		);
		await runDatabase(database =>
			database.db.insert(LedgerAccountBalanceMonitorsTable).values({
				id: new TypeID("lbm").toString(),
				accountId: dependent.id.toString(),
				name: "Monitor",
				alertThreshold: "0",
			})
		);

		const error = await runRepo(repository =>
			Effect.flip(repository.delete(organizationId, ledgerId, dependent.id))
		);
		expect(error).toBeInstanceOf(AccountHasDependents);

		const unused = await runRepo(repository =>
			repository.create(accountCreate(organizationId, ledgerId, { name: "Unused" }))
		);
		expect(
			await runRepo(repository => repository.delete(organizationId, ledgerId, unused.id))
		).toSatisfy(Option.isSome);
	});
});
