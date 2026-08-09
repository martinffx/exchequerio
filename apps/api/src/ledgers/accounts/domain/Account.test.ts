import { TypeID } from "typeid-js";
import { describe, expect, it } from "vitest";
import { makeCurrency, makeMinorUnits } from "../../domain/Currency";
import { Account } from "./Account";

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
	it("exposes the three balance views in Minor Units", () => {
		expect(makeAccount().balances).toEqual([
			{ balanceType: "pending", amount: -5, credits: 10, debits: 5 },
			{ balanceType: "posted", amount: 20, credits: 5, debits: 25 },
			{ balanceType: "availableBalance", amount: 15, credits: 7, debits: 22 },
		]);
	});

	it("keeps Currency and Normal Balance when replacing mutable details", () => {
		const account = makeAccount();
		const updated = account.withDetails({ name: "Operating Cash", metadata: { source: "erp" } });

		expect(updated.name).toBe("Operating Cash");
		expect(updated.metadata).toEqual({ source: "erp" });
		expect(updated.currency).toBe(account.currency);
		expect(updated.normalBalance).toBe("debit");
		expect(updated.lockVersion).toBe(1);
	});
});
