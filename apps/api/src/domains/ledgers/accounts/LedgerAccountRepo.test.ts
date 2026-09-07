import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import { LedgerNotFound } from "@/domains/ledgers";
import {
	type LedgerID,
	newLedgerAccountID,
	newLedgerID,
	newOrgID,
	type OrgID,
} from "@/repo/entities/types";
import { type LedgerAccountRow, LedgerAccountsTable } from "@/repo/schema";
import { type LedgerRepo, LedgerRepoTag, ledgerRepoLayer } from "../LedgerRepo";
import { Ledger } from "../Ledger";
import {
	type OrganizationRepo,
	OrganizationRepoTag,
	organizationRepoLayer,
} from "@/domains/organizations/OrganizationRepo";
import { Organization } from "@/domains/organizations/Organization";
import {
	AccountNameConflict,
	AccountPersistenceDecodingFailure,
	AccountPersistenceFailure,
	AccountVersionConflict,
} from "./AccountErrors";
import {
	type LedgerAccountRepo,
	LedgerAccountRepoTag,
	ledgerAccountRepoLayer,
} from "./LedgerAccountRepo";
import { LedgerAccount } from "./LedgerAccount";

const ledgerAccountCreate = (
	organizationId: OrgID,
	ledgerId: LedgerID,
	overrides: Partial<
		Pick<LedgerAccount, "id" | "name" | "description" | "normalBalance" | "currency" | "metadata">
	> = {}
): LedgerAccount => {
	const currency = overrides.currency ?? "USD";
	return LedgerAccount.fromCreateRequest(
		overrides.id ?? newLedgerAccountID(),
		organizationId,
		ledgerId,
		{
			name: overrides.name ?? "Cash",
			description: overrides.description,
			normalBalance: overrides.normalBalance ?? "debit",
			currencyCode: currency,
			metadata: overrides.metadata,
		}
	);
};

describe("LedgerAccountRepoLive", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const reposLayer = Layer.mergeAll(
		ledgerAccountRepoLayer,
		ledgerRepoLayer,
		organizationRepoLayer
	).pipe(Layer.provideMerge(databaseLayer));
	type TestRepos = LedgerAccountRepo | Database | LedgerRepo | OrganizationRepo;
	const runtime: ManagedRuntime.ManagedRuntime<TestRepos, never> = ManagedRuntime.make(reposLayer);
	const resources: Array<{ organizationId: OrgID; ledgerId: LedgerID }> = [];

	let repository: LedgerAccountRepo;
	let ledgerRepository: LedgerRepo;
	let organizationRepository: OrganizationRepo;
	let database: Database;

	beforeAll(async () => {
		repository = await runtime.runPromise(LedgerAccountRepoTag);
		ledgerRepository = await runtime.runPromise(LedgerRepoTag);
		organizationRepository = await runtime.runPromise(OrganizationRepoTag);
		database = await runtime.runPromise(DatabaseTag);
	});

	const createOrganizationAndLedger = async (): Promise<{
		organizationId: OrgID;
		ledgerId: LedgerID;
	}> => {
		const organizationId = newOrgID();
		const ledgerId = newLedgerID();
		await runtime.runPromise(
			organizationRepository.createOrganization(
				Organization.fromRequest(organizationId, {
					name: `LedgerAccount test ${organizationId.toString()}`,
				})
			)
		);
		await runtime.runPromise(
			ledgerRepository.createLedger(Ledger.fromRequest(ledgerId, organizationId, { name: "Ledger" }))
		);
		resources.push({ organizationId, ledgerId });
		return { organizationId, ledgerId };
	};

	afterAll(async () => {
		try {
			for (const { organizationId, ledgerId } of resources) {
				const accounts = await runtime.runPromise(
					repository.listAccounts(organizationId, ledgerId, { offset: 0, limit: 100 })
				);
				for (const account of accounts) {
					await runtime.runPromise(repository.deleteAccount(organizationId, ledgerId, account.id));
				}
				await runtime.runPromise(ledgerRepository.deleteLedger(organizationId, ledgerId));
				await runtime.runPromise(organizationRepository.deleteOrganization(organizationId));
			}
		} finally {
			await runtime.dispose();
		}
	});

	it("orders by creation descending with LedgerAccount ID as a stable tie-breaker", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const created = await runtime.runPromise(
			Effect.all(
				["A", "B", "C"].map(name =>
					repository.createAccount(ledgerAccountCreate(organizationId, ledgerId, { name }))
				)
			)
		);

		const accounts = await runtime.runPromise(
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
		const created = await runtime.runPromise(
			repository.createAccount(ledgerAccountCreate(owner.organizationId, owner.ledgerId))
		);

		expect(
			await runtime.runPromise(repository.getAccount(owner.organizationId, owner.ledgerId, created.id))
		).toSatisfy(Option.isSome);
		expect(
			await runtime.runPromise(repository.getAccount(other.organizationId, owner.ledgerId, created.id))
		).toEqual(Option.none());
		expect(
			await runtime.runPromise(repository.getAccount(owner.organizationId, other.ledgerId, created.id))
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
		const record = ledgerAccountCreate(organizationId, ledgerId, {
			description,
			currency: "US0378331005",
			metadata,
		});
		const created = await runtime.runPromise(repository.createAccount(record));

		expect(created.lockVersion).toBe(1);
		expect(record.toRow().created).toBeInstanceOf(Date);
		expect(record.toRow().updated).toBeInstanceOf(Date);
		expect(DateTime.isDateTime(created.created)).toBe(true);
		expect(DateTime.isDateTime(created.updated)).toBe(true);
		expect(created.created).toEqual(record.created);
		expect(created.updated).toEqual(record.updated);
		expect(created.description).toBe(description);
		expect(created.currency).toBe("US0378331005");
		expect(created.metadata).toEqual(metadata);
		expect(created.balances.every(balance => balance.amount === 0)).toBe(true);
	});

	it("encodes all stored Balances on creation", () => {
		const row = ledgerAccountCreate(newOrgID(), newLedgerID()).toRow() as LedgerAccountRow;

		expect(row).toMatchObject({
			pendingAmount: 0,
			postedAmount: 0,
			availableAmount: 0,
			pendingCredits: 0,
			pendingDebits: 0,
			postedCredits: 0,
			postedDebits: 0,
			availableCredits: 0,
			availableDebits: 0,
		});
	});

	it.each([
		{
			label: "debit-normal balances",
			normalBalance: "debit" as const,
			stored: {
				pendingAmount: 11,
				postedAmount: 12,
				availableAmount: 13,
				pendingCredits: 20,
				pendingDebits: 5,
				postedCredits: 30,
				postedDebits: 10,
				availableCredits: 40,
				availableDebits: 15,
			},
			expected: [
				{ balanceType: "pending", amount: 11, credits: 20, debits: 5 },
				{ balanceType: "posted", amount: 12, credits: 30, debits: 10 },
				{ balanceType: "availableBalance", amount: 13, credits: 40, debits: 15 },
			],
		},
		{
			label: "credit-normal balances",
			normalBalance: "credit" as const,
			stored: {
				pendingAmount: -11,
				postedAmount: -12,
				availableAmount: -13,
				pendingCredits: 5,
				pendingDebits: 20,
				postedCredits: 10,
				postedDebits: 30,
				availableCredits: 15,
				availableDebits: 40,
			},
			expected: [
				{ balanceType: "pending", amount: -11, credits: 5, debits: 20 },
				{ balanceType: "posted", amount: -12, credits: 10, debits: 30 },
				{ balanceType: "availableBalance", amount: -13, credits: 15, debits: 40 },
			],
		},
	])("preserves stored $label when decoding rows", async testCase => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const record = ledgerAccountCreate(organizationId, ledgerId, {
			name: testCase.label,
			normalBalance: testCase.normalBalance,
		});
		const db = database.db;
		await db.insert(LedgerAccountsTable).values({
			...record.toRow(),
			...testCase.stored,
		});

		const decoded = await runtime.runPromise(
			repository.getAccount(organizationId, ledgerId, record.id)
		);

		expect(Option.getOrThrow(decoded).balances).toEqual(testCase.expected);
	});

	it("returns a typed decoding failure for an invalid timestamp", async () => {
		const row = ledgerAccountCreate(newOrgID(), newLedgerID()).toRow() as LedgerAccountRow;
		const error = await Effect.runPromise(
			Effect.flip(LedgerAccount.fromRow({ ...row, created: new Date(Number.NaN) }))
		);

		expect(error).toBeInstanceOf(AccountPersistenceDecodingFailure);
	});

	it("maps duplicate names but not ID collisions to their public Conflict", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const first = ledgerAccountCreate(organizationId, ledgerId);
		await runtime.runPromise(repository.createAccount(first));

		const duplicateName = await runtime.runPromise(
			Effect.flip(repository.createAccount(ledgerAccountCreate(organizationId, ledgerId)))
		);
		expect(duplicateName).toBeInstanceOf(AccountNameConflict);

		const idCollision = await runtime.runPromise(
			Effect.flip(
				repository.createAccount(
					ledgerAccountCreate(organizationId, ledgerId, { id: first.id, name: "Other" })
				)
			)
		);
		expect(idCollision).toBeInstanceOf(AccountPersistenceFailure);
	});

	it("maps a missing or cross-Organization Ledger to LedgerNotFound", async () => {
		const owner = await createOrganizationAndLedger();
		const other = await createOrganizationAndLedger();
		const error = await runtime.runPromise(
			Effect.flip(repository.createAccount(ledgerAccountCreate(other.organizationId, owner.ledgerId)))
		);

		expect(error).toBeInstanceOf(LedgerNotFound);
	});

	it.each(["get", "delete"] as const)("returns explicit absence for missing %s", async operation => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const accountId = newLedgerAccountID();

		const result = await runtime.runPromise(
			operation === "get"
				? repository.getAccount(organizationId, ledgerId, accountId)
				: repository.deleteAccount(organizationId, ledgerId, accountId)
		);

		expect(result).toEqual(Option.none());
	});

	it("returns a version conflict when the update row is missing", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const missing = ledgerAccountCreate(organizationId, ledgerId);

		const error = await runtime.runPromise(Effect.flip(repository.updateAccount(missing)));

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
		const created = await runtime.runPromise(
			repository.createAccount(
				ledgerAccountCreate(organizationId, ledgerId, {
					description: "Before",
					metadata: { source: "before" },
				})
			)
		);
		const replacement = created.fromUpdateRequest({
			name: "Operating Cash",
			description: testCase.description,
			metadata: testCase.metadata,
		});
		const updated = await runtime.runPromise(repository.updateAccount(replacement));

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
		const error = await runtime.runPromise(
			Effect.flip(
				repository.updateAccount(
					created.fromUpdateRequest({
						name: "Stale",
					})
				)
			)
		);
		expect(error).toBeInstanceOf(AccountVersionConflict);
	});

	it("deletes an unused LedgerAccount", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const unused = await runtime.runPromise(
			repository.createAccount(ledgerAccountCreate(organizationId, ledgerId, { name: "Unused" }))
		);
		expect(
			await runtime.runPromise(repository.deleteAccount(organizationId, ledgerId, unused.id))
		).toSatisfy(Option.isSome);
	});

	it.each([
		{ label: "invalid serialized metadata", metadata: "{", lockVersion: 1 },
		{
			label: "non-string metadata value",
			metadata: JSON.stringify({ source: 42 }),
			lockVersion: 1,
		},
	])("returns a typed decoding failure for $label", async testCase => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const id = newLedgerAccountID();
		const db = database.db;
		const row = ledgerAccountCreate(organizationId, ledgerId, {
			name: `Malformed ${testCase.label}`,
		}).toRow();
		await db.insert(LedgerAccountsTable).values({
			...row,
			id: id.toUUID(),
			metadata: testCase.metadata ?? row.metadata,
			lockVersion: testCase.lockVersion,
		});

		try {
			const error = await runtime.runPromise(
				Effect.flip(repository.getAccount(organizationId, ledgerId, id))
			);
			expect(error).toBeInstanceOf(AccountPersistenceDecodingFailure);
		} finally {
			await db.delete(LedgerAccountsTable).where(eq(LedgerAccountsTable.id, id.toUUID()));
		}
	});
});
