import { readFile } from "node:fs/promises";
import pg from "pg";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { makeDatabaseLive } from "@/db";
import { Organization } from "@/domains/organizations/Organization";
import {
	organizationRepoLayer,
	type OrganizationRepo,
	OrganizationRepoTag,
} from "@/domains/organizations/OrganizationRepo";
import { Ledger } from "../Ledger";
import { type LedgerRepo, ledgerRepoLayer, LedgerRepoTag } from "../LedgerRepo";
import { LedgerAccount } from "../accounts/LedgerAccount";
import {
	type LedgerAccountRepo,
	ledgerAccountRepoLayer,
	LedgerAccountRepoTag,
} from "../accounts/LedgerAccountRepo";
import { LedgerTransaction } from "../transactions/LedgerTransaction";
import {
	ledgerTransactionRepoLayer,
	type LedgerTransactionRepo,
	LedgerTransactionRepoTag,
} from "../transactions/LedgerTransactionRepo";
import {
	newOrgID,
	newLedgerID,
	newLedgerAccountID,
	newLedgerTransactionID,
	newLedgerTransactionEntryID,
} from "@/repo/entities/types";
import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import {
	ledgerAccountSettlementRepoLayer,
	type LedgerAccountSettlementRepo,
	LedgerAccountSettlementRepoTag,
} from "./LedgerAccountSettlementRepo";

/** Repository dependencies for fixtures and Settlement persistence tests. */
const layers = Layer.mergeAll(
	organizationRepoLayer,
	ledgerRepoLayer,
	ledgerAccountRepoLayer,
	ledgerTransactionRepoLayer,
	ledgerAccountSettlementRepoLayer
);

/** Repository services supplied by the test runtime. */
type Services = Layer.Success<typeof layers>;
let runtime: ManagedRuntime.ManagedRuntime<Services, never>;
let organizations: OrganizationRepo;
let ledgers: LedgerRepo;
let accounts: LedgerAccountRepo;
let transactions: LedgerTransactionRepo;
let repo: LedgerAccountSettlementRepo;
const config = new Config();

/** Tracks scoped Ledger fixtures before creation so partial setup can be cleaned up. */
const fixtureLedgers: Array<{
	organizationId: ReturnType<typeof newOrgID>;
	ledgerId: ReturnType<typeof newLedgerID>;
}> = [];

/** Tracks Organizations created by this suite for repository-owned cleanup. */
const fixtureOrganizations = new Set<ReturnType<typeof newOrgID>>();

const now = () => DateTime.utc();

/**
 * Creates a Ledger and opposing USD Accounts through repositories.
 *
 * @param organizationId - Organization to create or reuse.
 * @param createOrganization - False when adding a sibling Ledger to an existing fixture.
 * @returns An Effect containing tracked fixture identifiers.
 */
const context = (organizationId = newOrgID(), createOrganization = true) =>
	Effect.gen(function* () {
		const ledgerId = newLedgerID(),
			settledAccountId = newLedgerAccountID(),
			contraAccountId = newLedgerAccountID();
		if (createOrganization) {
			fixtureOrganizations.add(organizationId);
			yield* organizations.createOrganization(
				Organization.fromRequest(organizationId, { name: "Settlement test" })
			);
		}
		fixtureLedgers.push({ organizationId, ledgerId });
		yield* ledgers.createLedger(Ledger.fromRequest(ledgerId, organizationId, { name: "Ledger" }));
		for (const [id, normalBalance] of [
			[settledAccountId, "debit"],
			[contraAccountId, "credit"],
		] as const)
			yield* accounts.createAccount(
				LedgerAccount.fromCreateRequest(id, organizationId, ledgerId, {
					name: id.toString(),
					currencyCode: "USD",
					normalBalance,
				})
			);
		return { organizationId, ledgerId, settledAccountId, contraAccountId };
	});

/** Organization, Ledger, and Account identifiers created by the fixture. */
type Owner = Effect.Success<ReturnType<typeof context>>;

/**
 * Persists a balanced source Transaction through the Transaction repository.
 *
 * @param owner - Fixture Ledger and Accounts.
 * @param amount - Positive Entry amount.
 * @param direction - Settled Account Entry direction.
 * @param effectiveAt - Parent Transaction effective time.
 * @param status - Source Transaction status.
 * @returns An Effect containing the Transaction and its settled Account Entry.
 */
const source = (
	owner: Owner,
	amount = 125,
	direction: "debit" | "credit" = "debit",
	effectiveAt: DateTime = now(),
	status: "pending" | "posted" = "posted"
) =>
	Effect.gen(function* () {
		const transaction = yield* LedgerTransaction.fromCreateRequest(
			newLedgerTransactionID(),
			owner.organizationId,
			owner.ledgerId,
			{
				status,
				effectiveAt: effectiveAt.toISO()!,
				ledgerEntries: [
					{ accountId: owner.settledAccountId.toString(), direction, amount, currencyCode: "USD" },
					{
						accountId: owner.contraAccountId.toString(),
						direction: direction === "debit" ? "credit" : "debit",
						amount,
						currencyCode: "USD",
					},
				],
			},
			now(),
			[newLedgerTransactionEntryID(), newLedgerTransactionEntryID()]
		);
		const created = yield* transactions.createTransaction(transaction);
		return { transaction: created, entry: Option.getOrThrow(created.entries)[0] };
	});
/**
 * Persists an empty manual Settlement through its repository.
 *
 * @param owner - Fixture Ledger and Accounts.
 * @param allowEitherDirection - Whether negative source nets are allowed.
 * @returns An Effect containing the draft.
 */
const draft = (owner: Owner, allowEitherDirection = false) =>
	Effect.gen(function* () {
		const entity = yield* LedgerAccountSettlementEntity.fromRequest(
			owner.organizationId,
			owner.ledgerId,
			{
				settledAccountId: owner.settledAccountId.toString(),
				contraAccountId: owner.contraAccountId.toString(),
				status: "drafting",
				allowEitherDirection,
			},
			"USD",
			now()
		);
		return yield* repo.createSettlement(entity, undefined, now());
	});

beforeAll(async () => {
	runtime = ManagedRuntime.make(layers.pipe(Layer.provide(makeDatabaseLive(config.databaseUrl))));
	organizations = await runtime.runPromise(OrganizationRepoTag);
	ledgers = await runtime.runPromise(LedgerRepoTag);
	accounts = await runtime.runPromise(LedgerAccountRepoTag);
	transactions = await runtime.runPromise(LedgerTransactionRepoTag);
	repo = await runtime.runPromise(LedgerAccountSettlementRepoTag);
});
afterAll(async () => {
	try {
		for (const fixture of fixtureLedgers)
			await runtime.runPromise(ledgers.deleteLedgerFixtures(fixture.organizationId, fixture.ledgerId));
		for (const id of fixtureOrganizations)
			await runtime.runPromise(organizations.deleteOrganization(id));
	} finally {
		await runtime.dispose();
	}
});

describe("Settlement repository processing", () => {
	it("deletes only the requested fixture Ledger and supports repeated cleanup", async () => {
		const owner = await runtime.runPromise(context()),
			sibling = await runtime.runPromise(context(owner.organizationId, false)),
			other = await runtime.runPromise(context());
		const entry = await runtime.runPromise(source(owner)),
			settlement = await runtime.runPromise(draft(owner));

		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				settlement.id,
				[entry.entry.id.toString()],
				true
			)
		);
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				settlement.id,
				{ status: "posted" },
				now()
			)
		);
		await runtime.runPromise(
			transactions.createSettlementTransaction(
				await runtime.runPromise(
					repo.buildTransaction(owner.organizationId, owner.ledgerId, settlement.id, now())
				)
			)
		);
		await runtime.runPromise(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, settlement.id, "posted", now())
		);
		await runtime.runPromise(ledgers.deleteLedgerFixtures(other.organizationId, owner.ledgerId));
		expect(
			Option.isSome(await runtime.runPromise(ledgers.getLedger(owner.organizationId, owner.ledgerId)))
		).toBe(true);
		await runtime.runPromise(ledgers.deleteLedgerFixtures(owner.organizationId, owner.ledgerId));
		await runtime.runPromise(ledgers.deleteLedgerFixtures(owner.organizationId, owner.ledgerId));
		expect(
			Option.isNone(await runtime.runPromise(ledgers.getLedger(owner.organizationId, owner.ledgerId)))
		).toBe(true);
		expect(
			await runtime.runPromise(repo.listSettlements(owner.organizationId, owner.ledgerId, 0, 20))
		).toEqual([]);
		expect(
			await runtime.runPromise(
				transactions.listTransactions(owner.organizationId, owner.ledgerId, { offset: 0, limit: 20 })
			)
		).toEqual([]);
		expect(
			Option.isSome(
				await runtime.runPromise(ledgers.getLedger(sibling.organizationId, sibling.ledgerId))
			)
		).toBe(true);
		expect(
			Option.isSome(await runtime.runPromise(ledgers.getLedger(other.organizationId, other.ledgerId)))
		).toBe(true);
	});

	it("rolls back fixture cleanup if a dependent record cannot be deleted", async () => {
		const owner = await runtime.runPromise(context()),
			entry = await runtime.runPromise(source(owner)),
			settlement = await runtime.runPromise(draft(owner));

		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				settlement.id,
				[entry.entry.id.toString()],
				true
			)
		);
		const connection = new pg.Client({ connectionString: config.databaseUrl });
		const limitedUrl = new URL(config.databaseUrl);
		limitedUrl.searchParams.set("options", "-c lock_timeout=100ms");
		const limitedRuntime = ManagedRuntime.make(
			ledgerRepoLayer.pipe(Layer.provide(makeDatabaseLive(limitedUrl.toString())))
		);
		try {
			await connection.connect();
			await connection.query("BEGIN");
			await connection.query("SELECT id FROM ledger_accounts WHERE id = $1 FOR UPDATE", [
				owner.settledAccountId.toUUID(),
			]);
			const ledgers = await limitedRuntime.runPromise(LedgerRepoTag);
			await expect(
				limitedRuntime.runPromise(ledgers.deleteLedgerFixtures(owner.organizationId, owner.ledgerId))
			).rejects.toThrow();
			expect(
				(
					await runtime.runPromise(
						repo.getSettlement(owner.organizationId, owner.ledgerId, settlement.id)
					)
				).status
			).toBe("drafting");
			expect(
				await runtime.runPromise(
					repo.listEntries(owner.organizationId, owner.ledgerId, settlement.id, 0, 20)
				)
			).toHaveLength(1);
			expect(
				await runtime.runPromise(
					transactions.listTransactions(owner.organizationId, owner.ledgerId, { offset: 0, limit: 20 })
				)
			).toHaveLength(1);
		} finally {
			await connection.query("ROLLBACK");
			await connection.end();
			await limitedRuntime.dispose();
		}
	});

	it("filters list and item reads by Organization and Ledger", async () => {
		const owner = await runtime.runPromise(context()),
			other = await runtime.runPromise(context(owner.organizationId, false));
		const entity = await runtime.runPromise(draft(owner));

		expect(
			await runtime.runPromise(repo.listSettlements(owner.organizationId, other.ledgerId, 0, 20))
		).toEqual([]);
		expect(await runtime.runPromise(repo.listSettlements(newOrgID(), owner.ledgerId, 0, 20))).toEqual(
			[]
		);
		await expect(
			runtime.runPromise(repo.getSettlement(owner.organizationId, other.ledgerId, entity.id))
		).rejects.toThrow("not found");
	});
	it("freezes sources, creates accounting once, and finalizes separately", async () => {
		const owner = await runtime.runPromise(context()),
			entry = await runtime.runPromise(source(owner));
		const entity = await runtime.runPromise(draft(owner));

		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[entry.entry.id.toString()],
				true
			)
		);
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "pending" },
				now()
			)
		);
		expect(
			(await runtime.runPromise(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id)))
				.status
		).toBe("processing");
		await expect(
			runtime.runPromise(
				repo.changeEntries(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					[entry.entry.id.toString()],
					false
				)
			)
		).rejects.toThrow("drafting");
		await expect(
			runtime.runPromise(
				repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "pending", now())
			)
		).rejects.toThrow("not completed");
		const accounting = await runtime.runPromise(
			repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		const [first, second] = await Promise.all([
			runtime.runPromise(transactions.createSettlementTransaction(accounting)),
			runtime.runPromise(transactions.createSettlementTransaction(accounting)),
		]);
		expect(first.id).toEqual(second.id);
		const pending = await runtime.runPromise(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "pending", now())
		);
		expect(pending.toResponse()).toMatchObject({
			status: "pending",
			amount: 125,
			settlementEntryDirection: "credit",
			transactionId: first.id.toString(),
		});
		const listed = await runtime.runPromise(
			repo.listSettlements(owner.organizationId, owner.ledgerId, 0, 1)
		);
		expect(listed.map(value => value.toResponse())).toEqual([pending.toResponse()]);
		expect(
			await runtime.runPromise(repo.listSettlements(owner.organizationId, owner.ledgerId, 1, 1))
		).toEqual([]);

		await expect(
			runtime.runPromise(
				transactions.postTransaction(owner.organizationId, owner.ledgerId, first.id, now())
			)
		).rejects.toThrow(/Settlement/);
		await expect(
			runtime.runPromise(
				transactions.voidTransaction(owner.organizationId, owner.ledgerId, first.id, now())
			)
		).rejects.toThrow(/Settlement/);
		await expect(
			runtime.runPromise(
				transactions.updateTransaction(owner.organizationId, owner.ledgerId, first.id, {
					ledgerEntries: [],
				})
			)
		).rejects.toThrow(/Settlement/);
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "posted" },
				now()
			)
		);
		const posted = await runtime.runPromise(
			transactions.postSettlementTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		expect(posted.id).toEqual(first.id);
		await runtime.runPromise(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "posted", now())
		);

		const account = Option.getOrThrow(
			await runtime.runPromise(
				accounts.getAccount(owner.organizationId, owner.ledgerId, owner.settledAccountId)
			)
		);
		expect(account.postedAmount).toBe(0);
	});
	it("retains accounting across voiding and releases sources only on finalization", async () => {
		const owner = await runtime.runPromise(context()),
			entry = await runtime.runPromise(source(owner)),
			entity = await runtime.runPromise(draft(owner));

		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[entry.entry.id.toString()],
				true
			)
		);
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "pending" },
				now()
			)
		);
		const accounting = await runtime.runPromise(
			transactions.createSettlementTransaction(
				await runtime.runPromise(
					repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
				)
			)
		);
		await runtime.runPromise(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "pending", now())
		);
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "voided" },
				now()
			)
		);
		await runtime.runPromise(
			transactions.voidSettlementTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		expect(
			await runtime.runPromise(
				repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20)
			)
		).toHaveLength(1);
		const voided = await runtime.runPromise(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "voided", now())
		);
		expect(voided.toResponse()).toMatchObject({
			status: "voided",
			amount: 125,
			transactionId: accounting.id.toString(),
		});
		expect(
			await runtime.runPromise(
				repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20)
			)
		).toEqual([]);
		const next = await runtime.runPromise(draft(owner));
		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				next.id,
				[entry.entry.id.toString()],
				true
			)
		);
	});
	it("nets mixed directions and requires permission for negative nets", async () => {
		const owner = await runtime.runPromise(context()),
			debit = await runtime.runPromise(source(owner, 40)),
			credit = await runtime.runPromise(source(owner, 100, "credit"));
		const entity = await runtime.runPromise(draft(owner));

		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[debit.entry.id.toString(), credit.entry.id.toString()],
				true
			)
		);
		await expect(
			runtime.runPromise(
				repo.prepareSettlement(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					{ status: "pending" },
					now()
				)
			)
		).rejects.toThrow("allowEitherDirection");
		expect(
			(await runtime.runPromise(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id)))
				.status
		).toBe("drafting");
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "voided" },
				now()
			)
		);
		const allowed = await runtime.runPromise(draft(owner, true));
		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				allowed.id,
				[debit.entry.id.toString(), credit.entry.id.toString()],
				true
			)
		);
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				allowed.id,
				{ status: "pending" },
				now()
			)
		);
		const transaction = await runtime.runPromise(
			repo.buildTransaction(owner.organizationId, owner.ledgerId, allowed.id, now())
		);
		expect(Option.getOrThrow(transaction.entries)[0]).toMatchObject({
			amount: 60,
			direction: "debit",
		});
	});
	it("rejects empty and zero nets without advancing state", async () => {
		const owner = await runtime.runPromise(context()),
			entity = await runtime.runPromise(draft(owner));

		await expect(
			runtime.runPromise(
				repo.prepareSettlement(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					{ status: "pending" },
					now()
				)
			)
		).rejects.toThrow("source Entries");
		const debit = await runtime.runPromise(source(owner)),
			credit = await runtime.runPromise(source(owner, 125, "credit"));
		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[debit.entry.id.toString(), credit.entry.id.toString()],
				true
			)
		);
		await expect(
			runtime.runPromise(
				repo.prepareSettlement(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					{ status: "pending" },
					now()
				)
			)
		).rejects.toThrow("nonzero");
	});
	it("selects backdated sources through cutoff equality and excludes future/pending sources", async () => {
		const owner = await runtime.runPromise(context()),
			cutoff = DateTime.fromISO("2026-08-01T00:00:00Z");
		const equal = await runtime.runPromise(source(owner, 50, "debit", cutoff));
		await runtime.runPromise(source(owner, 20, "debit", cutoff.minus({ days: 3 })));
		await runtime.runPromise(source(owner, 30, "debit", cutoff.plus({ milliseconds: 1 })));
		await runtime.runPromise(source(owner, 10, "debit", cutoff, "pending"));

		const entity = await runtime.runPromise(
			LedgerAccountSettlementEntity.fromRequest(
				owner.organizationId,
				owner.ledgerId,
				{
					settledAccountId: owner.settledAccountId.toString(),
					contraAccountId: owner.contraAccountId.toString(),
					status: "pending",
					effectiveAtUpperBound: cutoff.toISO()!,
				},
				"USD",
				now()
			)
		);
		const prepared = await runtime.runPromise(repo.createSettlement(entity, "pending", now()));
		expect(
			await runtime.runPromise(
				repo.listEntries(owner.organizationId, owner.ledgerId, prepared.id, 0, 20)
			)
		).toHaveLength(2);
		expect(
			(
				await runtime.runPromise(
					repo.listEntries(owner.organizationId, owner.ledgerId, prepared.id, 0, 20)
				)
			).map(e => e.id)
		).toContain(equal.entry.id.toString());
		expect(
			Option.getOrThrow(
				(
					await runtime.runPromise(
						repo.buildTransaction(owner.organizationId, owner.ledgerId, prepared.id, now())
					)
				).entries
			)[0].amount
		).toBe(70);
	});
	it("allows only one concurrent owner of a source Entry", async () => {
		const owner = await runtime.runPromise(context()),
			entry = await runtime.runPromise(source(owner)),
			first = await runtime.runPromise(draft(owner)),
			second = await runtime.runPromise(draft(owner));

		const results = await Promise.allSettled(
			[first, second].map(entity =>
				runtime.runPromise(
					repo.changeEntries(
						owner.organizationId,
						owner.ledgerId,
						entity.id,
						[entry.entry.id.toString()],
						true
					)
				)
			)
		);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
	});
	it("serializes source removal against processing without partial membership changes", async () => {
		const owner = await runtime.runPromise(context()),
			entry = await runtime.runPromise(source(owner)),
			entity = await runtime.runPromise(draft(owner));

		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[entry.entry.id.toString()],
				true
			)
		);
		const results = await Promise.allSettled([
			runtime.runPromise(
				repo.prepareSettlement(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					{ status: "pending" },
					now()
				)
			),
			runtime.runPromise(
				repo.changeEntries(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					[entry.entry.id.toString()],
					false
				)
			),
		]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		const stored = await runtime.runPromise(
			repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id)
		);
		const entries = await runtime.runPromise(
			repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20)
		);
		expect(entries).toHaveLength(stored.status === "processing" ? 1 : 0);
		expect(["processing", "drafting"]).toContain(stored.status);
	});
	it("excludes generated settled offsets while allowing their contra Entries as sources", async () => {
		const owner = await runtime.runPromise(context()),
			entry = await runtime.runPromise(source(owner)),
			entity = await runtime.runPromise(draft(owner));

		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[entry.entry.id.toString()],
				true
			)
		);
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "posted" },
				now()
			)
		);
		const accounting = await runtime.runPromise(
			transactions.createSettlementTransaction(
				await runtime.runPromise(
					repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
				)
			)
		);
		await runtime.runPromise(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "posted", now())
		);
		const entries = Option.getOrThrow(accounting.entries);
		const settled = entries.find(
			value => value.accountId.toString() === owner.settledAccountId.toString()
		)!;
		const contra = entries.find(
			value => value.accountId.toString() === owner.contraAccountId.toString()
		)!;
		const next = await runtime.runPromise(draft(owner));
		await expect(
			runtime.runPromise(
				repo.changeEntries(owner.organizationId, owner.ledgerId, next.id, [settled.id.toString()], true)
			)
		).rejects.toThrow(/eligible/);
		const reverse = await runtime.runPromise(
			draft(
				{ ...owner, settledAccountId: owner.contraAccountId, contraAccountId: owner.settledAccountId },
				true
			)
		);
		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				reverse.id,
				[contra.id.toString()],
				true
			)
		);
		expect(
			await runtime.runPromise(
				repo.listEntries(owner.organizationId, owner.ledgerId, reverse.id, 0, 20)
			)
		).toHaveLength(1);
	});

	it("rolls back creation and automatic source reservation when the net is invalid", async () => {
		const owner = await runtime.runPromise(context());
		const debit = await runtime.runPromise(source(owner)),
			credit = await runtime.runPromise(source(owner, 125, "credit"));

		const entity = await runtime.runPromise(
			LedgerAccountSettlementEntity.fromRequest(
				owner.organizationId,
				owner.ledgerId,
				{
					settledAccountId: owner.settledAccountId.toString(),
					contraAccountId: owner.contraAccountId.toString(),
					status: "pending",
					effectiveAtUpperBound: now().toISO()!,
				},
				"USD",
				now()
			)
		);
		await expect(runtime.runPromise(repo.createSettlement(entity, "pending", now()))).rejects.toThrow(
			/nonzero/
		);
		await expect(
			runtime.runPromise(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id))
		).rejects.toThrow(/not found/);
		const manual = await runtime.runPromise(draft(owner));
		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				manual.id,
				[debit.entry.id.toString(), credit.entry.id.toString()],
				true
			)
		);
		expect(
			await runtime.runPromise(
				repo.listEntries(owner.organizationId, owner.ledgerId, manual.id, 0, 20)
			)
		).toHaveLength(2);
	});
	it("preserves omitted metadata, replaces supplied metadata, and restricts terminal edits", async () => {
		const owner = await runtime.runPromise(context()),
			entity = await runtime.runPromise(draft(owner));
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ description: "initial", metadata: { first: "one", second: "two" } },
				now()
			)
		);
		const omitted = await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ description: "edited" },
				now()
			)
		);
		expect(omitted.toResponse().metadata).toEqual({ first: "one", second: "two" });
		const replaced = await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ metadata: { third: "three" } },
				now()
			)
		);
		expect(replaced.toResponse().metadata).toEqual({ third: "three" });
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "voided" },
				now()
			)
		);
		await expect(
			runtime.runPromise(
				repo.prepareSettlement(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					{ description: "forbidden" },
					now()
				)
			)
		).rejects.toThrow(/metadata/);
		const cleared = await runtime.runPromise(
			repo.prepareSettlement(owner.organizationId, owner.ledgerId, entity.id, { metadata: {} }, now())
		);
		expect(cleared.toResponse()).toMatchObject({
			status: "voided",
			description: "edited",
			metadata: {},
		});
	});
	it("rejects Account ownership mismatches at creation", async () => {
		const owner = await runtime.runPromise(context()),
			otherLedger = await runtime.runPromise(context(owner.organizationId, false)),
			otherOrganization = await runtime.runPromise(context());
		for (const other of [otherLedger, otherOrganization]) {
			await expect(
				runtime.runPromise(draft({ ...owner, contraAccountId: other.contraAccountId }))
			).rejects.toThrow(/Accounts.*Ledger/);
		}
	});
	it("rejects membership requests larger than 500 without changing membership", async () => {
		const owner = await runtime.runPromise(context()),
			entity = await runtime.runPromise(draft(owner));
		await expect(
			runtime.runPromise(
				repo.changeEntries(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					Array.from({ length: 501 }, () => newLedgerTransactionEntryID().toString()),
					true
				)
			)
		).rejects.toThrow(/500/);
		expect(
			await runtime.runPromise(
				repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20)
			)
		).toEqual([]);
	});
	it("accepts 10000 manual sources and rejects larger manual and automatic selections", async () => {
		const owner = await runtime.runPromise(context());
		const ids: string[] = [];
		for (let remaining = 10001; remaining > 0;) {
			const count = Math.min(199, remaining);
			const transaction = await runtime.runPromise(
				LedgerTransaction.fromCreateRequest(
					newLedgerTransactionID(),
					owner.organizationId,
					owner.ledgerId,
					{
						status: "posted",
						ledgerEntries: [
							...Array.from({ length: count }, () => ({
								accountId: owner.settledAccountId.toString(),
								direction: "debit" as const,
								amount: 1,
								currencyCode: "USD",
							})),
							{
								accountId: owner.contraAccountId.toString(),
								direction: "credit",
								amount: count,
								currencyCode: "USD",
							},
						],
					}
				)
			);
			const created = await runtime.runPromise(transactions.createTransaction(transaction));
			ids.push(
				...Option.getOrThrow(created.entries)
					.filter(entry => entry.accountId.toString() === owner.settledAccountId.toString())
					.map(entry => entry.id.toString())
			);
			remaining -= count;
		}
		const automatic = await runtime.runPromise(
			LedgerAccountSettlementEntity.fromRequest(
				owner.organizationId,
				owner.ledgerId,
				{
					settledAccountId: owner.settledAccountId.toString(),
					contraAccountId: owner.contraAccountId.toString(),
					status: "pending",
					effectiveAtUpperBound: now().toISO()!,
				},
				"USD",
				now()
			)
		);
		await expect(
			runtime.runPromise(repo.createSettlement(automatic, "pending", now()))
		).rejects.toThrow(/10000/);
		const entity = await runtime.runPromise(draft(owner));
		for (let offset = 0; offset < 10000; offset += 500)
			await runtime.runPromise(
				repo.changeEntries(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					ids.slice(offset, offset + 500),
					true
				)
			);
		await expect(
			runtime.runPromise(
				repo.changeEntries(owner.organizationId, owner.ledgerId, entity.id, [ids[10000]], true)
			)
		).rejects.toThrow(/10000/);
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "pending" },
				now()
			)
		);
		const accounting = await runtime.runPromise(
			repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		expect(Option.getOrThrow(accounting.entries)[0].amount).toBe(10000);
	}, 30_000);
	it("rolls back generated accounting and projections when an Account write violates its limit", async () => {
		const owner = await runtime.runPromise(context());
		await runtime.runPromise(source(owner, Number.MAX_SAFE_INTEGER, "credit"));
		const selected = await runtime.runPromise(source(owner, 125));
		const entity = await runtime.runPromise(draft(owner));
		const before = await Promise.all(
			[owner.settledAccountId, owner.contraAccountId].map(id =>
				runtime.runPromise(accounts.getAccount(owner.organizationId, owner.ledgerId, id))
			)
		);
		await runtime.runPromise(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[selected.entry.id.toString()],
				true
			)
		);
		await runtime.runPromise(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "pending" },
				now()
			)
		);
		const accounting = await runtime.runPromise(
			repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		await expect(
			runtime.runPromise(transactions.createSettlementTransaction(accounting))
		).rejects.toThrow(/persistence/);
		expect(
			Option.isNone(
				await runtime.runPromise(
					transactions.getSettlementTransaction(owner.organizationId, owner.ledgerId, entity.id)
				)
			)
		).toBe(true);
		expect(
			await runtime.runPromise(
				transactions.listTransactions(owner.organizationId, owner.ledgerId, { offset: 0, limit: 20 })
			)
		).toHaveLength(2);
		expect(
			(await runtime.runPromise(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id)))
				.status
		).toBe("processing");
		const after = await Promise.all(
			[owner.settledAccountId, owner.contraAccountId].map(id =>
				runtime.runPromise(accounts.getAccount(owner.organizationId, owner.ledgerId, id))
			)
		);
		expect(after).toEqual(before);
	});
	it.each([false, true])(
		"refuses migration preflight with an existing Settlement (membership: %s)",
		async withMembership => {
			const client = new pg.Client({ connectionString: config.databaseUrl });
			try {
				const owner = await runtime.runPromise(context()),
					entity = await runtime.runPromise(draft(owner));
				if (withMembership) {
					const entry = await runtime.runPromise(source(owner));
					await runtime.runPromise(
						repo.changeEntries(
							owner.organizationId,
							owner.ledgerId,
							entity.id,
							[entry.entry.id.toString()],
							true
						)
					);
				}
				const migration = await readFile(
					new URL(
						"../../../../migrations/20260906201020_settlement-corrections/migration.sql",
						import.meta.url
					),
					"utf8"
				);
				const preflight = migration.split("--> statement-breakpoint")[0];
				await client.connect();
				await expect(client.query(preflight)).rejects.toThrow(
					"Settlement corrections require empty Settlement tables"
				);
				expect(
					(await runtime.runPromise(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id)))
						.status
				).toBe("drafting");
				expect(
					await runtime.runPromise(
						repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20)
					)
				).toHaveLength(withMembership ? 1 : 0);
			} finally {
				await client.end();
			}
		},
		30_000
	);
});
