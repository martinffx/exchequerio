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
	OrganizationRepoTag,
} from "@/domains/organizations/OrganizationRepo";
import { Ledger } from "../Ledger";
import { ledgerRepoLayer, LedgerRepoTag } from "../LedgerRepo";
import { LedgerAccount } from "../accounts/LedgerAccount";
import { ledgerAccountRepoLayer, LedgerAccountRepoTag } from "../accounts/LedgerAccountRepo";
import { LedgerTransaction } from "../transactions/LedgerTransaction";
import {
	ledgerTransactionRepoLayer,
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
	LedgerAccountSettlementRepoTag,
} from "./LedgerAccountSettlementRepo";

const layers = Layer.mergeAll(
	organizationRepoLayer,
	ledgerRepoLayer,
	ledgerAccountRepoLayer,
	ledgerTransactionRepoLayer,
	ledgerAccountSettlementRepoLayer
);
type Services = Layer.Success<typeof layers>;
let runtime: ManagedRuntime.ManagedRuntime<Services, never>;
const config = new Config();
const fixtureLedgers: Array<{
	organizationId: ReturnType<typeof newOrgID>;
	ledgerId: ReturnType<typeof newLedgerID>;
}> = [];
const fixtureOrganizations = new Set<ReturnType<typeof newOrgID>>();
const run = <A, E>(effect: Effect.Effect<A, E, Services>) => runtime.runPromise(effect);
const now = () => DateTime.utc();
const context = (organizationId = newOrgID(), createOrganization = true) =>
	Effect.gen(function* () {
		const organizations = yield* OrganizationRepoTag,
			ledgers = yield* LedgerRepoTag,
			accounts = yield* LedgerAccountRepoTag;
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
type Owner = Effect.Success<ReturnType<typeof context>>;
const source = (
	owner: Owner,
	amount = 125,
	direction: "debit" | "credit" = "debit",
	effectiveAt: DateTime = now(),
	status: "pending" | "posted" = "posted"
) =>
	Effect.gen(function* () {
		const repo = yield* LedgerTransactionRepoTag;
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
		const created = yield* repo.createTransaction(transaction);
		return { transaction: created, entry: Option.getOrThrow(created.entries)[0] };
	});
const draft = (owner: Owner, allowEitherDirection = false) =>
	Effect.gen(function* () {
		const repo = yield* LedgerAccountSettlementRepoTag;
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

beforeAll(() => {
	runtime = ManagedRuntime.make(layers.pipe(Layer.provide(makeDatabaseLive(config.databaseUrl))));
});
afterAll(async () => {
	try {
		const ledgers = await run(LedgerRepoTag),
			organizations = await run(OrganizationRepoTag);
		for (const fixture of fixtureLedgers)
			await run(ledgers.deleteLedgerFixtures(fixture.organizationId, fixture.ledgerId));
		for (const id of fixtureOrganizations) await run(organizations.deleteOrganization(id));
	} finally {
		await runtime.dispose();
	}
});

describe("Settlement repository processing", () => {
	it("deletes only the requested fixture Ledger and supports repeated cleanup", async () => {
		const owner = await run(context()),
			sibling = await run(context(owner.organizationId, false)),
			other = await run(context());
		const entry = await run(source(owner)),
			settlement = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag),
			ledgers = await run(LedgerRepoTag),
			transactions = await run(LedgerTransactionRepoTag);
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				settlement.id,
				[entry.entry.id.toString()],
				true
			)
		);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				settlement.id,
				{ status: "posted" },
				now()
			)
		);
		await run(
			transactions.createSettlementTransaction(
				await run(repo.buildTransaction(owner.organizationId, owner.ledgerId, settlement.id, now()))
			)
		);
		await run(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, settlement.id, "posted", now())
		);
		await run(ledgers.deleteLedgerFixtures(other.organizationId, owner.ledgerId));
		expect(Option.isSome(await run(ledgers.getLedger(owner.organizationId, owner.ledgerId)))).toBe(
			true
		);
		await run(ledgers.deleteLedgerFixtures(owner.organizationId, owner.ledgerId));
		await run(ledgers.deleteLedgerFixtures(owner.organizationId, owner.ledgerId));
		expect(Option.isNone(await run(ledgers.getLedger(owner.organizationId, owner.ledgerId)))).toBe(
			true
		);
		expect(await run(repo.listSettlements(owner.organizationId, owner.ledgerId, 0, 20))).toEqual([]);
		expect(
			await run(
				transactions.listTransactions(owner.organizationId, owner.ledgerId, { offset: 0, limit: 20 })
			)
		).toEqual([]);
		expect(
			Option.isSome(await run(ledgers.getLedger(sibling.organizationId, sibling.ledgerId)))
		).toBe(true);
		expect(Option.isSome(await run(ledgers.getLedger(other.organizationId, other.ledgerId)))).toBe(
			true
		);
	});

	it("rolls back fixture cleanup if a dependent record cannot be deleted", async () => {
		const owner = await run(context()),
			entry = await run(source(owner)),
			settlement = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag),
			transactions = await run(LedgerTransactionRepoTag);
		await run(
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
				owner.settledAccountId.toString(),
			]);
			const ledgers = await limitedRuntime.runPromise(LedgerRepoTag);
			await expect(
				limitedRuntime.runPromise(ledgers.deleteLedgerFixtures(owner.organizationId, owner.ledgerId))
			).rejects.toThrow();
			expect(
				(await run(repo.getSettlement(owner.organizationId, owner.ledgerId, settlement.id))).status
			).toBe("drafting");
			expect(
				await run(repo.listEntries(owner.organizationId, owner.ledgerId, settlement.id, 0, 20))
			).toHaveLength(1);
			expect(
				await run(
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
		const owner = await run(context()),
			other = await run(context(owner.organizationId, false));
		const entity = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag);
		expect(await run(repo.listSettlements(owner.organizationId, other.ledgerId, 0, 20))).toEqual([]);
		expect(await run(repo.listSettlements(newOrgID(), owner.ledgerId, 0, 20))).toEqual([]);
		await expect(
			run(repo.getSettlement(owner.organizationId, other.ledgerId, entity.id))
		).rejects.toThrow("not found");
	});
	it("freezes sources, creates accounting once, and finalizes separately", async () => {
		const owner = await run(context()),
			entry = await run(source(owner));
		const entity = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag),
			transactions = await run(LedgerTransactionRepoTag);
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[entry.entry.id.toString()],
				true
			)
		);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "pending" },
				now()
			)
		);
		expect(
			(await run(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id))).status
		).toBe("processing");
		await expect(
			run(
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
			run(repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "pending", now()))
		).rejects.toThrow("not completed");
		const accounting = await run(
			repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		const [first, second] = await Promise.all([
			run(transactions.createSettlementTransaction(accounting)),
			run(transactions.createSettlementTransaction(accounting)),
		]);
		expect(first.id).toEqual(second.id);
		const pending = await run(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "pending", now())
		);
		expect(pending.toResponse()).toMatchObject({
			status: "pending",
			amount: 125,
			settlementEntryDirection: "credit",
			transactionId: first.id.toString(),
		});
		const listed = await run(repo.listSettlements(owner.organizationId, owner.ledgerId, 0, 1));
		expect(listed.map(value => value.toResponse())).toEqual([pending.toResponse()]);
		expect(await run(repo.listSettlements(owner.organizationId, owner.ledgerId, 1, 1))).toEqual([]);

		await expect(
			run(transactions.postTransaction(owner.organizationId, owner.ledgerId, first.id, now()))
		).rejects.toThrow(/Settlement/);
		await expect(
			run(transactions.voidTransaction(owner.organizationId, owner.ledgerId, first.id, now()))
		).rejects.toThrow(/Settlement/);
		await expect(
			run(
				transactions.updateTransaction(owner.organizationId, owner.ledgerId, first.id, {
					ledgerEntries: [],
				})
			)
		).rejects.toThrow(/Settlement/);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "posted" },
				now()
			)
		);
		const posted = await run(
			transactions.postSettlementTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		expect(posted.id).toEqual(first.id);
		await run(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "posted", now())
		);
		const accounts = await run(LedgerAccountRepoTag);
		const account = Option.getOrThrow(
			await run(accounts.getAccount(owner.organizationId, owner.ledgerId, owner.settledAccountId))
		);
		expect(account.postedAmount).toBe(0);
	});
	it("retains accounting across voiding and releases sources only on finalization", async () => {
		const owner = await run(context()),
			entry = await run(source(owner)),
			entity = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag),
			transactions = await run(LedgerTransactionRepoTag);
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[entry.entry.id.toString()],
				true
			)
		);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "pending" },
				now()
			)
		);
		const accounting = await run(
			transactions.createSettlementTransaction(
				await run(repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now()))
			)
		);
		await run(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "pending", now())
		);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "voided" },
				now()
			)
		);
		await run(
			transactions.voidSettlementTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		expect(
			await run(repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20))
		).toHaveLength(1);
		const voided = await run(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "voided", now())
		);
		expect(voided.toResponse()).toMatchObject({
			status: "voided",
			amount: 125,
			transactionId: accounting.id.toString(),
		});
		expect(
			await run(repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20))
		).toEqual([]);
		const next = await run(draft(owner));
		await run(
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
		const owner = await run(context()),
			debit = await run(source(owner, 40)),
			credit = await run(source(owner, 100, "credit"));
		const entity = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag);
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[debit.entry.id.toString(), credit.entry.id.toString()],
				true
			)
		);
		await expect(
			run(
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
			(await run(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id))).status
		).toBe("drafting");
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "voided" },
				now()
			)
		);
		const allowed = await run(draft(owner, true));
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				allowed.id,
				[debit.entry.id.toString(), credit.entry.id.toString()],
				true
			)
		);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				allowed.id,
				{ status: "pending" },
				now()
			)
		);
		const transaction = await run(
			repo.buildTransaction(owner.organizationId, owner.ledgerId, allowed.id, now())
		);
		expect(Option.getOrThrow(transaction.entries)[0]).toMatchObject({
			amount: 60,
			direction: "debit",
		});
	});
	it("rejects empty and zero nets without advancing state", async () => {
		const owner = await run(context()),
			entity = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag);
		await expect(
			run(
				repo.prepareSettlement(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					{ status: "pending" },
					now()
				)
			)
		).rejects.toThrow("source Entries");
		const debit = await run(source(owner)),
			credit = await run(source(owner, 125, "credit"));
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[debit.entry.id.toString(), credit.entry.id.toString()],
				true
			)
		);
		await expect(
			run(
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
		const owner = await run(context()),
			cutoff = DateTime.fromISO("2026-08-01T00:00:00Z");
		const equal = await run(source(owner, 50, "debit", cutoff));
		await run(source(owner, 20, "debit", cutoff.minus({ days: 3 })));
		await run(source(owner, 30, "debit", cutoff.plus({ milliseconds: 1 })));
		await run(source(owner, 10, "debit", cutoff, "pending"));
		const repo = await run(LedgerAccountSettlementRepoTag);
		const entity = await run(
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
		const prepared = await run(repo.createSettlement(entity, "pending", now()));
		expect(
			await run(repo.listEntries(owner.organizationId, owner.ledgerId, prepared.id, 0, 20))
		).toHaveLength(2);
		expect(
			(await run(repo.listEntries(owner.organizationId, owner.ledgerId, prepared.id, 0, 20))).map(
				e => e.id
			)
		).toContain(equal.entry.id.toString());
		expect(
			Option.getOrThrow(
				(await run(repo.buildTransaction(owner.organizationId, owner.ledgerId, prepared.id, now())))
					.entries
			)[0].amount
		).toBe(70);
	});
	it("allows only one concurrent owner of a source Entry", async () => {
		const owner = await run(context()),
			entry = await run(source(owner)),
			first = await run(draft(owner)),
			second = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag);
		const results = await Promise.allSettled(
			[first, second].map(entity =>
				run(
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
		const owner = await run(context()),
			entry = await run(source(owner)),
			entity = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag);
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[entry.entry.id.toString()],
				true
			)
		);
		const results = await Promise.allSettled([
			run(
				repo.prepareSettlement(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					{ status: "pending" },
					now()
				)
			),
			run(
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
		const stored = await run(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id));
		const entries = await run(
			repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20)
		);
		expect(entries).toHaveLength(stored.status === "processing" ? 1 : 0);
		expect(["processing", "drafting"]).toContain(stored.status);
	});
	it("excludes generated settled offsets while allowing their contra Entries as sources", async () => {
		const owner = await run(context()),
			entry = await run(source(owner)),
			entity = await run(draft(owner));
		const repo = await run(LedgerAccountSettlementRepoTag),
			transactions = await run(LedgerTransactionRepoTag);
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[entry.entry.id.toString()],
				true
			)
		);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "posted" },
				now()
			)
		);
		const accounting = await run(
			transactions.createSettlementTransaction(
				await run(repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now()))
			)
		);
		await run(
			repo.finalizeSettlement(owner.organizationId, owner.ledgerId, entity.id, "posted", now())
		);
		const entries = Option.getOrThrow(accounting.entries);
		const settled = entries.find(
			value => value.accountId.toString() === owner.settledAccountId.toString()
		)!;
		const contra = entries.find(
			value => value.accountId.toString() === owner.contraAccountId.toString()
		)!;
		const next = await run(draft(owner));
		await expect(
			run(
				repo.changeEntries(owner.organizationId, owner.ledgerId, next.id, [settled.id.toString()], true)
			)
		).rejects.toThrow(/eligible/);
		const reverse = await run(
			draft(
				{ ...owner, settledAccountId: owner.contraAccountId, contraAccountId: owner.settledAccountId },
				true
			)
		);
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				reverse.id,
				[contra.id.toString()],
				true
			)
		);
		expect(
			await run(repo.listEntries(owner.organizationId, owner.ledgerId, reverse.id, 0, 20))
		).toHaveLength(1);
	});

	it("rolls back creation and automatic source reservation when the net is invalid", async () => {
		const owner = await run(context());
		const debit = await run(source(owner)),
			credit = await run(source(owner, 125, "credit"));
		const repo = await run(LedgerAccountSettlementRepoTag);
		const entity = await run(
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
		await expect(run(repo.createSettlement(entity, "pending", now()))).rejects.toThrow(/nonzero/);
		await expect(
			run(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id))
		).rejects.toThrow(/not found/);
		const manual = await run(draft(owner));
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				manual.id,
				[debit.entry.id.toString(), credit.entry.id.toString()],
				true
			)
		);
		expect(
			await run(repo.listEntries(owner.organizationId, owner.ledgerId, manual.id, 0, 20))
		).toHaveLength(2);
	});
	it("preserves omitted metadata, replaces supplied metadata, and restricts terminal edits", async () => {
		const owner = await run(context()),
			entity = await run(draft(owner)),
			repo = await run(LedgerAccountSettlementRepoTag);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ description: "initial", metadata: { first: "one", second: "two" } },
				now()
			)
		);
		const omitted = await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ description: "edited" },
				now()
			)
		);
		expect(omitted.toResponse().metadata).toEqual({ first: "one", second: "two" });
		const replaced = await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ metadata: { third: "three" } },
				now()
			)
		);
		expect(replaced.toResponse().metadata).toEqual({ third: "three" });
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "voided" },
				now()
			)
		);
		await expect(
			run(
				repo.prepareSettlement(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					{ description: "forbidden" },
					now()
				)
			)
		).rejects.toThrow(/metadata/);
		const cleared = await run(
			repo.prepareSettlement(owner.organizationId, owner.ledgerId, entity.id, { metadata: {} }, now())
		);
		expect(cleared.toResponse()).toMatchObject({
			status: "voided",
			description: "edited",
			metadata: {},
		});
	});
	it("rejects Account ownership mismatches at creation", async () => {
		const owner = await run(context()),
			otherLedger = await run(context(owner.organizationId, false)),
			otherOrganization = await run(context());
		for (const other of [otherLedger, otherOrganization]) {
			await expect(run(draft({ ...owner, contraAccountId: other.contraAccountId }))).rejects.toThrow(
				/Accounts.*Ledger/
			);
		}
	});
	it("rejects membership requests larger than 500 without changing membership", async () => {
		const owner = await run(context()),
			entity = await run(draft(owner)),
			repo = await run(LedgerAccountSettlementRepoTag);
		await expect(
			run(
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
			await run(repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20))
		).toEqual([]);
	});
	it("accepts 10000 manual sources and rejects larger manual and automatic selections", async () => {
		const owner = await run(context()),
			repo = await run(LedgerAccountSettlementRepoTag),
			transactions = await run(LedgerTransactionRepoTag);
		const ids: string[] = [];
		for (let remaining = 10001; remaining > 0;) {
			const count = Math.min(199, remaining);
			const transaction = await run(
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
			const created = await run(transactions.createTransaction(transaction));
			ids.push(
				...Option.getOrThrow(created.entries)
					.filter(entry => entry.accountId.toString() === owner.settledAccountId.toString())
					.map(entry => entry.id.toString())
			);
			remaining -= count;
		}
		const automatic = await run(
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
		await expect(run(repo.createSettlement(automatic, "pending", now()))).rejects.toThrow(/10000/);
		const entity = await run(draft(owner));
		for (let offset = 0; offset < 10000; offset += 500)
			await run(
				repo.changeEntries(
					owner.organizationId,
					owner.ledgerId,
					entity.id,
					ids.slice(offset, offset + 500),
					true
				)
			);
		await expect(
			run(repo.changeEntries(owner.organizationId, owner.ledgerId, entity.id, [ids[10000]], true))
		).rejects.toThrow(/10000/);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "pending" },
				now()
			)
		);
		const accounting = await run(
			repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		expect(Option.getOrThrow(accounting.entries)[0].amount).toBe(10000);
	}, 30_000);
	it("rolls back generated accounting and projections when an Account write violates its limit", async () => {
		const owner = await run(context());
		await run(source(owner, Number.MAX_SAFE_INTEGER, "credit"));
		const selected = await run(source(owner, 125));
		const entity = await run(draft(owner)),
			repo = await run(LedgerAccountSettlementRepoTag),
			transactions = await run(LedgerTransactionRepoTag),
			accounts = await run(LedgerAccountRepoTag);
		const before = await Promise.all(
			[owner.settledAccountId, owner.contraAccountId].map(id =>
				run(accounts.getAccount(owner.organizationId, owner.ledgerId, id))
			)
		);
		await run(
			repo.changeEntries(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				[selected.entry.id.toString()],
				true
			)
		);
		await run(
			repo.prepareSettlement(
				owner.organizationId,
				owner.ledgerId,
				entity.id,
				{ status: "pending" },
				now()
			)
		);
		const accounting = await run(
			repo.buildTransaction(owner.organizationId, owner.ledgerId, entity.id, now())
		);
		await expect(run(transactions.createSettlementTransaction(accounting))).rejects.toThrow(
			/persistence/
		);
		expect(
			Option.isNone(
				await run(
					transactions.getSettlementTransaction(owner.organizationId, owner.ledgerId, entity.id)
				)
			)
		).toBe(true);
		expect(
			await run(
				transactions.listTransactions(owner.organizationId, owner.ledgerId, { offset: 0, limit: 20 })
			)
		).toHaveLength(2);
		expect(
			(await run(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id))).status
		).toBe("processing");
		const after = await Promise.all(
			[owner.settledAccountId, owner.contraAccountId].map(id =>
				run(accounts.getAccount(owner.organizationId, owner.ledgerId, id))
			)
		);
		expect(after).toEqual(before);
	});
	it.each([false, true])(
		"refuses migration preflight with an existing Settlement (membership: %s)",
		async withMembership => {
			const client = new pg.Client({ connectionString: config.databaseUrl });
			try {
				const owner = await run(context()),
					entity = await run(draft(owner)),
					repo = await run(LedgerAccountSettlementRepoTag);
				if (withMembership) {
					const entry = await run(source(owner));
					await run(
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
					(await run(repo.getSettlement(owner.organizationId, owner.ledgerId, entity.id))).status
				).toBe("drafting");
				expect(
					await run(repo.listEntries(owner.organizationId, owner.ledgerId, entity.id, 0, 20))
				).toHaveLength(withMembership ? 1 : 0);
			} finally {
				await client.end();
			}
		},
		30_000
	);
});
