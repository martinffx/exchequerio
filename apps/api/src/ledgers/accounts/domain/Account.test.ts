import { Effect, Option } from "effect";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@/repo/schema";
import { makeCurrency, makeMinorUnits } from "../../domain/Currency";
import { AccountPersistenceDecodingFailure } from "../AccountErrors";
import { Account } from "./Account";

const row = {
	id: "lat_01h2x3y4z5a6b7c8d9e0f1g2h3",
	organizationId: "org_01h2x3y4z5a6b7c8d9e0f1g2h3",
	ledgerId: "lgr_01h2x3y4z5a6b7c8d9e0f1g2h3",
	name: "Cash",
	// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
	description: null,
	normalBalance: "debit",
	currencyCode: "USD",
	minorUnitExponent: 2,
	pendingAmount: -5,
	postedAmount: 20,
	availableAmount: 15,
	pendingCredits: 10,
	pendingDebits: 5,
	postedCredits: 5,
	postedDebits: 25,
	availableCredits: 7,
	availableDebits: 22,
	lockVersion: 1,
	metadata: JSON.stringify({ source: "erp" }),
	created: new Date("2026-08-09T10:00:00.000Z"),
	updated: new Date("2026-08-09T11:00:00.000Z"),
} satisfies AccountRow;

const makeAccount = () =>
	new Account({
		id: new TypeID("lat"),
		organizationId: new TypeID("org"),
		ledgerId: new TypeID("lgr"),
		name: "Cash",
		normalBalance: "debit",
		currency: makeCurrency("USD", 2),
		pendingAmount: makeMinorUnits(-5),
		pendingCredits: makeMinorUnits(10),
		pendingDebits: makeMinorUnits(5),
		postedAmount: makeMinorUnits(20),
		postedCredits: makeMinorUnits(5),
		postedDebits: makeMinorUnits(25),
		availableAmount: makeMinorUnits(15),
		availableCredits: makeMinorUnits(7),
		availableDebits: makeMinorUnits(22),
		lockVersion: 1,
		created: new Date("2026-08-09T10:00:00.000Z"),
		updated: new Date("2026-08-09T11:00:00.000Z"),
	});

describe("Account", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates immutable fields and initial balances from a request", () => {
		const id = new TypeID("lat");
		const organizationId = new TypeID("org");
		const ledgerId = new TypeID("lgr");
		const account = Account.fromRequest(id, organizationId, ledgerId, {
			name: "Broker position",
			normalBalance: "credit",
			currencyCode: "US0378331005",
			minorUnitExponent: 4,
		});

		expect(account).toMatchObject({ id, organizationId, ledgerId, lockVersion: 1 });
		expect(account.currency).toEqual({ code: "US0378331005", minorUnitExponent: 4 });
		expect(account.balances.every(balance => balance.amount === 0)).toBe(true);
		expect(account.updated).toEqual(account.created);
	});

	it("exposes the three balance views in Minor Units", () => {
		expect(makeAccount().balances).toEqual([
			{ balanceType: "pending", amount: -5, credits: 10, debits: 5 },
			{ balanceType: "posted", amount: 20, credits: 5, debits: 25 },
			{ balanceType: "availableBalance", amount: 15, credits: 7, debits: 22 },
		]);
	});

	it("round-trips a complete create row", () => {
		const account = Option.getOrThrow(Effect.runSync(Account.fromRow(row)));

		expect(account.metadata).toEqual({ source: "erp" });
		expect(account.toCreateRow()).toEqual(row);
	});

	it("encodes an update row with application time and the next lock version", () => {
		vi.useFakeTimers();
		const updated = new Date("2026-08-10T12:00:00.000Z");
		vi.setSystemTime(updated);
		const account = makeAccount().updateFromRequest({
			name: "Operating Cash",
			metadata: { source: "treasury" },
		});

		expect(account.updated).toEqual(updated);
		expect(account.toUpdateRow()).toEqual({
			name: "Operating Cash",
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: null,
			metadata: JSON.stringify({ source: "treasury" }),
			lockVersion: 2,
			updated,
		});
	});

	it("returns None when no row exists", () => {
		expect(Effect.runSync(Account.fromRow(undefined))).toEqual(Option.none());
	});

	it.each([
		{ ...row, id: "not-an-account" },
		{ ...row, organizationId: "not-an-organization" },
		{ ...row, ledgerId: "not-a-ledger" },
		{ ...row, currencyCode: "" },
		{ ...row, minorUnitExponent: -1 },
		{ ...row, pendingAmount: Number.MAX_SAFE_INTEGER + 1 },
		{ ...row, lockVersion: -1 },
		{ ...row, metadata: "{" },
		{ ...row, metadata: JSON.stringify({ source: 42 }) },
		{ ...row, created: new Date("invalid") },
		{ ...row, updated: new Date("invalid") },
	])("fails with a typed error when persisted data cannot be decoded", invalidRow => {
		const error = Effect.runSync(Account.fromRow(invalidRow).pipe(Effect.flip));

		expect(error).toBeInstanceOf(AccountPersistenceDecodingFailure);
	});
});
