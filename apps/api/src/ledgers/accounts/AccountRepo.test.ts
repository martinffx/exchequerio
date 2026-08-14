import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { makeDatabaseLive } from "@/db";
import { LedgerNotFound, makeCurrency } from "@/ledgers";
import {
	type LedgerID,
	newLedgerAccountID,
	newLedgerID,
	newOrgID,
	type OrgID,
} from "@/repo/entities/types";
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
	const currency = overrides.currency ?? makeCurrency("USD", 2);
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
		Layer.provide(databaseLayer)
	);
	type TestRepos = AccountRepo | LedgerRepo | OrganizationRepo;
	const runtime: ManagedRuntime.ManagedRuntime<TestRepos, never> = ManagedRuntime.make(reposLayer);
	const resources: Array<{ organizationId: OrgID; ledgerId: LedgerID }> = [];

	const runAccountRepo = <A, E>(use: (repository: AccountRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(AccountRepoTag.pipe(Effect.flatMap(use)));
	const runLedgerRepo = <A, E>(use: (repository: LedgerRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(LedgerRepoTag.pipe(Effect.flatMap(use)));
	const runOrganizationRepo = <A, E>(use: (repository: OrganizationRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(OrganizationRepoTag.pipe(Effect.flatMap(use)));

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
				right.created.getTime() - left.created.getTime() ||
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

	it("creates at lockVersion 1 and decodes Account Currency", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const created = await runAccountRepo(repository =>
			repository.createAccount(
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

	it("allows the first update and rejects a stale version", async () => {
		const { organizationId, ledgerId } = await createOrganizationAndLedger();
		const created = await runAccountRepo(repository =>
			repository.createAccount(accountCreate(organizationId, ledgerId))
		);
		const updated = await runAccountRepo(repository =>
			repository.updateAccount(
				created.updateFromRequest({
					name: "Operating Cash",
				})
			)
		);

		expect(updated.name).toBe("Operating Cash");
		expect(updated.lockVersion).toBe(2);
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
});
