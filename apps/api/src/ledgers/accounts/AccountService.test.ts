import { Effect, Layer, Option } from "effect";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { Ledger } from "../domain/Ledger";
import type { LedgerService } from "../LedgerService";
import { LedgerServiceTag } from "../LedgerService";
import { makeCurrency, makeMinorUnits } from "../domain/Currency";
import { Account, type AccountCreate } from "./domain/Account";
import { AccountNotFound } from "./AccountErrors";
import type { AccountRepo } from "./AccountRepo";
import { AccountRepoTag } from "./AccountRepo";
import { AccountService, AccountServiceTag, accountServiceLayer } from "./AccountService";

const organizationId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const accountId = new TypeID("lat") as LedgerAccountID;
const ledger = new Ledger({
	id: ledgerId,
	organizationId,
	name: "Ledger",
	created: new Date("2026-08-09T10:00:00.000Z"),
	updated: new Date("2026-08-09T10:00:00.000Z"),
});
const account = new Account({
	id: accountId,
	organizationId,
	ledgerId,
	name: "Cash",
	normalBalance: "debit",
	currency: makeCurrency("USD", 2),
	pendingAmount: makeMinorUnits(0),
	postedAmount: makeMinorUnits(0),
	availableAmount: makeMinorUnits(0),
	pendingCredits: makeMinorUnits(0),
	pendingDebits: makeMinorUnits(0),
	postedCredits: makeMinorUnits(0),
	postedDebits: makeMinorUnits(0),
	availableCredits: makeMinorUnits(0),
	availableDebits: makeMinorUnits(0),
	lockVersion: 1,
	created: new Date("2026-08-09T10:00:00.000Z"),
	updated: new Date("2026-08-09T10:00:00.000Z"),
});
// oxlint-disable-next-line unicorn/no-array-callback-reference -- Effect Option constructor, not an iterator.
const someAccount = Option.some(account);

const repository = (overrides: Partial<AccountRepo> = {}): AccountRepo =>
	vi.mocked<AccountRepo>({
		list: vi.fn(() => Effect.succeed([account])),
		get: vi.fn(() => Effect.succeed(someAccount)),
		create: vi.fn(() => Effect.succeed(account)),
		update: vi.fn(() => Effect.succeed(account)),
		delete: vi.fn(() => Effect.succeed(someAccount)),
		...overrides,
	});

const ledgerService = (): LedgerService =>
	vi.mocked<LedgerService>({
		listLedgers: vi.fn(() => Effect.succeed([ledger])),
		getLedger: vi.fn(() => Effect.succeed(ledger)),
		createLedger: vi.fn(() => Effect.succeed(ledger)),
		updateLedger: vi.fn(() => Effect.succeed(ledger)),
		deleteLedger: vi.fn(() => Effect.succeed(ledger)),
	} as unknown as LedgerService);

const runService = <A, E>(
	repositoryImplementation: AccountRepo,
	ledgerImplementation: LedgerService,
	use: (service: AccountService) => Effect.Effect<A, E>
) =>
	Effect.runPromise(
		AccountServiceTag.pipe(Effect.flatMap(use)).pipe(
			Effect.provide(
				accountServiceLayer.pipe(
					Layer.provide(
						Layer.merge(
							Layer.succeed(AccountRepoTag, repositoryImplementation),
							Layer.succeed(LedgerServiceTag, ledgerImplementation)
						)
					)
				)
			)
		)
	);

describe("AccountService", () => {
	it("checks the parent Ledger before listing Accounts", async () => {
		const repo = repository();
		const parent = ledgerService();

		await runService(repo, parent, service =>
			service.listAccounts(organizationId, ledgerId, { offset: 10, limit: 5 })
		);

		expect(parent.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
		expect(repo.list).toHaveBeenCalledWith(organizationId, ledgerId, { offset: 10, limit: 5 });
	});

	it("generates a canonical Account ID and creates immutable fields", async () => {
		const repo = repository({
			create: vi.fn((record: AccountCreate) =>
				Effect.succeed(
					new Account({
						...account,
						...record,
					})
				)
			),
		});
		const parent = ledgerService();

		const created = await runService(repo, parent, service =>
			service.createAccount(organizationId, ledgerId, {
				name: "Broker position",
				normalBalance: "credit",
				currencyCode: "US0378331005",
				minorUnitExponent: 4,
			})
		);

		expect(created.id.toString()).toMatch(/^lat_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
		expect(parent.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
		expect(repo.create).toHaveBeenCalledWith({
			id: created.id,
			organizationId,
			ledgerId,
			name: "Broker position",
			normalBalance: "credit",
			currency: { code: "US0378331005", minorUnitExponent: 4 },
		});
	});

	it("passes the current lock version into update without changing immutable fields", async () => {
		const repo = repository();

		await runService(repo, ledgerService(), service =>
			service.updateAccount(organizationId, ledgerId, accountId, {
				name: "Operating Cash",
			})
		);

		expect(repo.get).toHaveBeenCalledWith(organizationId, ledgerId, accountId);
		expect(repo.update).toHaveBeenCalledWith({
			id: accountId,
			organizationId,
			ledgerId,
			name: "Operating Cash",
			expectedLockVersion: 1,
		});
	});

	it.each(["get", "update", "delete"] as const)(
		"maps an absent %s Account to AccountNotFound",
		async operation => {
			const repo = repository({
				get: vi.fn(() => Effect.succeed(Option.none())),
				delete: vi.fn(() => Effect.succeed(Option.none())),
			});
			const error = await runService(repo, ledgerService(), service =>
				Effect.flip(
					operation === "get"
						? service.getAccount(organizationId, ledgerId, accountId)
						: operation === "update"
							? service.updateAccount(organizationId, ledgerId, accountId, { name: "Missing" })
							: service.deleteAccount(organizationId, ledgerId, accountId)
				)
			);

			expect(error).toEqual(
				new AccountNotFound(organizationId.toString(), ledgerId.toString(), accountId.toString())
			);
		}
	);
});
