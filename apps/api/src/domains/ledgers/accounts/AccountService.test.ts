import { Asset } from "@/domains/assets/Asset";
import { TypeID } from "typeid-js";
import { AssetServiceTag, type AssetService } from "@/domains/assets/AssetService";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newLedgerAccountID, newLedgerID, newOrgID } from "@/lib/ids";
import { Ledger } from "../Ledger";
import type { LedgerService } from "../LedgerService";
import { LedgerServiceTag } from "../LedgerService";
import { AccountNotFound } from "./AccountErrors";
import type { LedgerAccountRepo } from "./LedgerAccountRepo";
import { LedgerAccountRepoTag } from "./LedgerAccountRepo";
import { AccountService, AccountServiceTag, accountServiceLayer } from "./AccountService";
import { LedgerAccount } from "./LedgerAccount";

const organizationId = newOrgID();
const assetEntity = Asset.fromRequest(
	new TypeID("ast"),
	organizationId,
	{ code: "USD", name: "Dollar", minorUnitExponent: 2 },
	DateTime.utc()
);
const asset = assetEntity.toSummary();
const assetService = {
	getAsset: vi.fn(() => Effect.succeed(assetEntity)),
} as unknown as AssetService;
const ledgerId = newLedgerID();
const accountId = newLedgerAccountID();
const ledger = new Ledger({
	id: ledgerId,
	organizationId,
	name: "Ledger",
	created: DateTime.fromISO("2026-08-09T10:00:00.000Z", { zone: "utc" }),
	updated: DateTime.fromISO("2026-08-09T10:00:00.000Z", { zone: "utc" }),
});
const created = DateTime.fromISO("2026-08-09T10:00:00.000Z", {
	zone: "utc",
});
const account = LedgerAccount.fromCreateRequest(
	accountId,
	organizationId,
	ledgerId,
	{
		name: "Cash",
		normalBalance: "debit",
		assetCode: "USD",
	},
	asset,
	created
);
// oxlint-disable-next-line unicorn/no-array-callback-reference -- Effect Option constructor, not an iterator.
const someAccount = Option.some(account);

const repo = vi.mocked<LedgerAccountRepo>({
	listAccounts: vi.fn(() => Effect.succeed([account])),
	getAccount: vi.fn(() => Effect.succeed(someAccount)),
	createAccount: vi.fn(() => Effect.succeed(account)),
	updateAccount: vi.fn(() => Effect.succeed(account)),
	deleteAccount: vi.fn(() => Effect.succeed(someAccount)),
});
const parent = vi.mocked<LedgerService>({
	listLedgers: vi.fn(() => Effect.succeed([ledger])),
	getLedger: vi.fn(() => Effect.succeed(ledger)),
	createLedger: vi.fn(() => Effect.succeed(ledger)),
	updateLedger: vi.fn(() => Effect.succeed(ledger)),
	deleteLedger: vi.fn(() => Effect.succeed(ledger)),
} as unknown as LedgerService);
const runtime = ManagedRuntime.make(
	accountServiceLayer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(LedgerAccountRepoTag, repo),
				Layer.succeed(LedgerServiceTag, parent),
				Layer.succeed(AssetServiceTag, assetService)
			)
		)
	)
);
let service: AccountService;
beforeAll(async () => {
	service = await runtime.runPromise(AccountServiceTag);
});
beforeEach(() => {
	vi.resetAllMocks();
});
afterAll(() => runtime.dispose());

describe("AccountService", () => {
	it("checks the parent Ledger before listing Accounts", async () => {
		await runtime.runPromise(
			service.listAccounts(organizationId, ledgerId, { offset: 10, limit: 5 })
		);

		expect(parent.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
		expect(repo.listAccounts).toHaveBeenCalledWith(organizationId, ledgerId, {
			offset: 10,
			limit: 5,
		});
	});

	it.each([
		{
			name: "complete values",
			request: {
				name: "Broker position",
				description: "Custody",
				normalBalance: "credit" as const,
				assetCode: "US0378331005",
				metadata: { externalId: "position-42" },
			},
		},
		{
			name: "omitted optional values",
			request: {
				name: "Cash",
				description: undefined,
				normalBalance: "debit" as const,
				assetCode: "USD",
				metadata: undefined,
			},
		},
		{
			name: "resolved Asset code",
			request: {
				name: "Lowercase code",
				description: undefined,
				normalBalance: "debit" as const,
				assetCode: "usd",
				metadata: undefined,
			},
		},
	])("creates Account domain state from $name", async ({ request }) => {
		repo.createAccount.mockImplementation((record: LedgerAccount) => Effect.succeed(record));

		const created = await runtime.runPromise(
			service.createAccount(organizationId, ledgerId, request)
		);

		expect(created).toMatchObject({
			organizationId,
			ledgerId,
			name: request.name,
			description: request.description,
			normalBalance: request.normalBalance,
			...asset,
			metadata: request.metadata,
			lockVersion: 1,
		});
		expect(created.id.toString()).toMatch(/^lat_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
		expect(DateTime.isDateTime(created.created)).toBe(true);
		expect(DateTime.isDateTime(created.updated)).toBe(true);
		expect(created.updated).toEqual(created.created);
		expect(created.balances).toEqual([
			{ balanceType: "pending", amount: 0n, credits: 0n, debits: 0n },
			{ balanceType: "posted", amount: 0n, credits: 0n, debits: 0n },
			{ balanceType: "availableBalance", amount: 0n, credits: 0n, debits: 0n },
		]);
		expect(parent.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
		expect(assetService.getAsset).toHaveBeenCalledWith(organizationId, request.assetCode);
		expect(repo.createAccount).toHaveBeenCalledWith(created);
		expect(vi.mocked(repo.createAccount).mock.calls[0]?.[0]).toBeInstanceOf(LedgerAccount);
	});

	it("passes the current lock version into update without changing immutable fields", async () => {
		await runtime.runPromise(
			service.updateAccount(organizationId, ledgerId, accountId, {
				name: "Operating Cash",
			})
		);

		expect(repo.getAccount).toHaveBeenCalledWith(organizationId, ledgerId, accountId);
		expect(repo.updateAccount).toHaveBeenCalledWith(
			expect.objectContaining({
				id: accountId,
				organizationId,
				ledgerId,
				name: "Operating Cash",
				normalBalance: account.normalBalance,
				assetId: account.assetId,
				created: account.created,
				lockVersion: 1,
			})
		);
		const update = vi.mocked(repo.updateAccount).mock.calls[0]?.[0];
		expect(update).toBeInstanceOf(LedgerAccount);
		expect(update?.balances).toEqual(account.balances);
	});

	it.each(["get", "update", "delete"] as const)(
		"maps an absent %s Account to AccountNotFound",
		async operation => {
			repo.getAccount.mockImplementation(() => Effect.succeed(Option.none()));
			repo.deleteAccount.mockImplementation(() => Effect.succeed(Option.none()));
			const error = await runtime.runPromise(
				Effect.flip(
					operation === "get"
						? service.getAccount(organizationId, ledgerId, accountId)
						: operation === "update"
							? service.updateAccount(organizationId, ledgerId, accountId, { name: "Missing" })
							: service.deleteAccount(organizationId, ledgerId, accountId)
				)
			);

			expect(error).toEqual(new AccountNotFound());
		}
	);
});
