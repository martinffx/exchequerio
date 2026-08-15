import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import { LedgerNotFound } from "@/ledgers";
import {
	type LedgerAccountID,
	type LedgerID,
	newLedgerAccountID,
	newLedgerID,
	newOrgID,
	type OrgID,
} from "@/repo/entities/types";
import { LedgerAccountsTable } from "@/repo/schema";
import { type LedgerRepo, LedgerRepoTag, ledgerRepoLayer } from "../LedgerRepo";
import { Ledger } from "../domain/Ledger";
import {
	type OrganizationRepo,
	OrganizationRepoTag,
	organizationRepoLayer,
} from "@/organizations/OrganizationRepo";
import { Organization } from "@/organizations/domain/Organization";
import {
	AccountNameConflict,
	AccountPersistenceDecodingFailure,
	AccountPersistenceFailure,
	AccountVersionConflict,
} from "./AccountErrors";
import { type AccountRepo, AccountRepoTag, accountRepoLayer } from "./AccountRepo";
import { Account } from "./domain/Account";

const accountCreate = (
	organizationId: OrgID,
	ledgerId: LedgerID,
	overrides: Partial<
		Pick<Account, "id" | "name" | "description" | "normalBalance" | "currency" | "metadata">
	> = {}
): Account => {
	const currency = overrides.currency ?? { code: "USD", minorUnitExponent: 2 };
	return Account.fromRequest(overrides.id ?? newLedgerAccountID(), organizationId, ledgerId, {
		name: overrides.name ?? "Cash",
		description: overrides.description,
		normalBalance: overrides.normalBalance ?? "debit",
		currencyCode: currency.code,
		minorUnitExponent: currency.minorUnitExponent,
		metadata: overrides.metadata,
	});
};

describe("AccountRepoLive", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const reposLayer = Layer.mergeAll(accountRepoLayer, ledgerRepoLayer, organizationRepoLayer).pipe(
		Layer.provideMerge(databaseLayer)
	);
	type TestRepos = AccountRepo | Database | LedgerRepo | OrganizationRepo;
	const runtime: ManagedRuntime.ManagedRuntime<TestRepos, never> = ManagedRuntime.make(reposLayer);
	const resources: Array<{ organizationId: OrgID; ledgerId: LedgerID }> = [];

	const runAccountRepo = <A, E>(use: (repository: AccountRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(AccountRepoTag.pipe(Effect.flatMap(use)));
	const runLedgerRepo = <A, E>(use: (repository: LedgerRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(LedgerRepoTag.pipe(Effect.flatMap(use)));
	const runOrganizationRepo = <A, E>(use: (repository: OrganizationRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(OrganizationRepoTag.pipe(Effect.flatMap(use)));
	const database = () => runtime.runPromise(DatabaseTag);

	const createOrganizationAndLedger = async (): Promise<{
		organizationId: OrgID;
		ledgerId: LedgerID;
	}> => {
		const organizationId = newOrgID();
		const ledgerId = newLedgerID();
		await runOrganizationRepo(repository =>
			repository.createOrganization(
				Organization.fromRequest(organizationId, {
					name: `Account test ${organizationId.toString()}`,
				})
			)
		);
		await runLedgerRepo(repository =>
			repository.createLedger(Ledger.fromRequest(ledgerId, organizationId, { name: "Ledger" }))
		);
		resources.push({ organizationId, ledgerId });
		return { organizationId, ledgerId };
	};

	afterAll(async () => {
		try {
			for (const { organizationId, ledgerId } of resources) {
				const accounts = await runAccountRepo(repository =>
					repository.listAccounts(organizationId, ledgerId, { offset: 0, limit: 100 })
				);
				for (const account of accounts) {
					await runAccountRepo(repository =>
						repository.deleteAccount(organizationId, ledgerId, account.id)
					);
				}
				await runLedgerRepo(repository => repository.deleteLedger(organizationId, ledgerId));
				await runOrganizationRepo(repository => repository.deleteOrganization(organizationId));
			}
		} finally {
			await runtime.dispose();
		}
	});

	it("orders by creation descending with Account ID as a stable tie-breaker", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const created = await runAccountRepo(repository =>
			Effect.all(
				["A", "B", "C"].map(name =>
					repository.createAccount(accountCreate(organizationId, ledgerId, { name }))
				)
			)
		);

		const accounts = await runAccountRepo(repository =>
			repository.listAccounts(organizationId, ledgerId, { offset: 0, limit: 100 })
		);
		const expected = [...created].sort(
			(left, right) =>
				right.created.toMillis() - left.created.toMillis() ||
				left.id.toString().localeCompare(right.id.toString())
		);
		expect(accounts.map(account => account.id)).toEqual(expected.map(account => account.id));
	});

	it("enforces Organization and Ledger scope", async () => {
		const owner = await createOrganizationAndLedger();
		const other = await createOrganizationAndLedger();
		const created = await runAccountRepo(repository =>
			repository.createAccount(accountCreate(owner.organizationId, owner.ledgerId))
		);

		expect(
			await runAccountRepo(repository =>
				repository.getAccount(owner.organizationId, owner.ledgerId, created.id)
			)
		).toSatisfy(Option.isSome);
		expect(
			await runAccountRepo(repository =>
				repository.getAccount(other.organizationId, owner.ledgerId, created.id)
			)
		).toEqual(Option.none());
		expect(
			await runAccountRepo(repository =>
				repository.getAccount(owner.organizationId, other.ledgerId, created.id)
			)
		).toEqual(Option.none());
	});

	it.each([
		{
			label: "stored optional values",
			description: "Custody cash",
			metadata: { externalId: "cash-42" },
		},
		{ label: "omitted optional values", description: undefined, metadata: undefined },
	])("creates and decodes $label", async ({ description, metadata }) => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const record = accountCreate(organizationId, ledgerId, {
			description,
			currency: { code: "US0378331005", minorUnitExponent: 4 },
			metadata,
		});
		const created = await runAccountRepo(repository => repository.createAccount(record));

		expect(created.lockVersion).toBe(1);
		expect(record.toCreateRow().created).toBeInstanceOf(Date);
		expect(record.toCreateRow().updated).toBeInstanceOf(Date);
		expect(DateTime.isDateTime(created.created)).toBe(true);
		expect(DateTime.isDateTime(created.updated)).toBe(true);
		expect(created.created).toEqual(record.created);
		expect(created.updated).toEqual(record.updated);
		expect(created.description).toBe(description);
		expect(created.currency).toEqual({ code: "US0378331005", minorUnitExponent: 4 });
		expect(created.metadata).toEqual(metadata);
		expect(created.balances.every(balance => balance.amount === 0)).toBe(true);
	});

	it("encodes only the four authoritative counters on creation", () => {
		const row = accountCreate(newOrgID(), newLedgerID()).toCreateRow();

		expect(row).toMatchObject({
			pendingCredits: 0,
			pendingDebits: 0,
			postedCredits: 0,
			postedDebits: 0,
		});
		for (const column of [
			"pendingAmount",
			"postedAmount",
			"availableAmount",
			"availableCredits",
			"availableDebits",
		]) {
			expect(row).not.toHaveProperty(column);
		}
	});

	it.each([
		{
			label: "debit-normal balances",
			normalBalance: "debit" as const,
			counters: { pendingCredits: 20, pendingDebits: 5, postedCredits: 30, postedDebits: 10 },
			expected: [
				{ balanceType: "pending", amount: -15, credits: 20, debits: 5 },
				{ balanceType: "posted", amount: -20, credits: 30, debits: 10 },
				{ balanceType: "availableBalance", amount: -10, credits: 20, debits: 10 },
			],
		},
		{
			label: "credit-normal balances",
			normalBalance: "credit" as const,
			counters: { pendingCredits: 5, pendingDebits: 20, postedCredits: 10, postedDebits: 30 },
			expected: [
				{ balanceType: "pending", amount: -15, credits: 5, debits: 20 },
				{ balanceType: "posted", amount: -20, credits: 10, debits: 30 },
				{ balanceType: "availableBalance", amount: -10, credits: 10, debits: 20 },
			],
		},
	])("derives $label from authoritative counters when decoding rows", async testCase => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const record = accountCreate(organizationId, ledgerId, {
			name: testCase.label,
			normalBalance: testCase.normalBalance,
		});
		const db = (await database()).db;
		await db.insert(LedgerAccountsTable).values({
			...record.toCreateRow(),
			...testCase.counters,
			pendingAmount: 101,
			postedAmount: 102,
			availableAmount: 103,
			availableCredits: 104,
			availableDebits: 105,
		});

		const decoded = await runAccountRepo(repository =>
			repository.getAccount(organizationId, ledgerId, record.id)
		);

		expect(Option.getOrThrow(decoded).balances).toEqual(testCase.expected);
	});

	it("returns a typed decoding failure for an invalid timestamp", async () => {
		const row = accountCreate(newOrgID(), newLedgerID()).toCreateRow();
		const error = await Effect.runPromise(
			Effect.flip(Account.fromRow({ ...row, created: new Date(Number.NaN) }))
		);

		expect(error).toBeInstanceOf(AccountPersistenceDecodingFailure);
	});

	it("maps duplicate names but not ID collisions to their public Conflict", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const first = accountCreate(organizationId, ledgerId);
		await runAccountRepo(repository => repository.createAccount(first));

		const duplicateName = await runAccountRepo(repository =>
			Effect.flip(repository.createAccount(accountCreate(organizationId, ledgerId)))
		);
		expect(duplicateName).toBeInstanceOf(AccountNameConflict);

		const idCollision = await runAccountRepo(repository =>
			Effect.flip(
				repository.createAccount(
					accountCreate(organizationId, ledgerId, { id: first.id, name: "Other" })
				)
			)
		);
		expect(idCollision).toBeInstanceOf(AccountPersistenceFailure);
	});

	it("maps a missing or cross-Organization Ledger to LedgerNotFound", async () => {
		const owner = await createOrganizationAndLedger();
		const other = await createOrganizationAndLedger();
		const error = await runAccountRepo(repository =>
			Effect.flip(repository.createAccount(accountCreate(other.organizationId, owner.ledgerId)))
		);

		expect(error).toBeInstanceOf(LedgerNotFound);
	});

	it.each(["get", "delete"] as const)("returns explicit absence for missing %s", async operation => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const accountId = newLedgerAccountID();

		const result = await runAccountRepo(repository =>
			operation === "get"
				? repository.getAccount(organizationId, ledgerId, accountId)
				: repository.deleteAccount(organizationId, ledgerId, accountId)
		);

		expect(result).toEqual(Option.none());
	});

	it("returns a version conflict when the update row is missing", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const missing = accountCreate(organizationId, ledgerId);

		const error = await runAccountRepo(repository => Effect.flip(repository.updateAccount(missing)));

		expect(error).toBeInstanceOf(AccountVersionConflict);
	});

	it.each([
		{
			label: "replaces optional values",
			description: "Operating funds",
			metadata: { source: "treasury" },
		},
		{ label: "clears optional values", description: undefined, metadata: undefined },
	])("$label on the first update and rejects a stale version", async testCase => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const created = await runAccountRepo(repository =>
			repository.createAccount(
				accountCreate(organizationId, ledgerId, {
					description: "Before",
					metadata: { source: "before" },
				})
			)
		);
		const replacement = created.updateFromRequest({
			name: "Operating Cash",
			description: testCase.description,
			metadata: testCase.metadata,
		});
		const updated = await runAccountRepo(repository => repository.updateAccount(replacement));

		expect(updated.name).toBe("Operating Cash");
		expect(updated.description).toBe(testCase.description);
		expect(updated.metadata).toEqual(testCase.metadata);
		expect(updated.organizationId).toEqual(created.organizationId);
		expect(updated.ledgerId).toEqual(created.ledgerId);
		expect(updated.normalBalance).toBe(created.normalBalance);
		expect(updated.currency).toEqual(created.currency);
		expect(updated.created).toEqual(created.created);
		expect(updated.lockVersion).toBe(2);
		expect(updated.updated).toEqual(replacement.updated);
		const error = await runAccountRepo(repository =>
			Effect.flip(
				repository.updateAccount(
					created.updateFromRequest({
						name: "Stale",
					})
				)
			)
		);
		expect(error).toBeInstanceOf(AccountVersionConflict);
	});

	it("deletes an unused Account", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const unused = await runAccountRepo(repository =>
			repository.createAccount(accountCreate(organizationId, ledgerId, { name: "Unused" }))
		);
		expect(
			await runAccountRepo(repository => repository.deleteAccount(organizationId, ledgerId, unused.id))
		).toSatisfy(Option.isSome);
	});

	it.each([
		{ label: "invalid ID", id: "not-an-account", metadata: undefined, lockVersion: 1 },
		{ label: "invalid serialized metadata", id: undefined, metadata: "{", lockVersion: 1 },
		{
			label: "non-string metadata value",
			id: undefined,
			metadata: JSON.stringify({ source: 42 }),
			lockVersion: 1,
		},
		{ label: "negative lock version", id: undefined, metadata: undefined, lockVersion: -1 },
	])("returns a typed decoding failure for $label", async testCase => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const id = testCase.id ?? newLedgerAccountID().toString();
		const db = (await database()).db;
		const row = accountCreate(organizationId, ledgerId, {
			name: `Malformed ${testCase.label}`,
		}).toCreateRow();
		await db.insert(LedgerAccountsTable).values({
			...row,
			id,
			metadata: testCase.metadata ?? row.metadata,
			lockVersion: testCase.lockVersion,
		});

		try {
			const error = await runAccountRepo(repository =>
				Effect.flip(repository.getAccount(organizationId, ledgerId, id as unknown as LedgerAccountID))
			);
			expect(error).toBeInstanceOf(AccountPersistenceDecodingFailure);
		} finally {
			await db.delete(LedgerAccountsTable).where(eq(LedgerAccountsTable.id, id));
		}
	});
});
