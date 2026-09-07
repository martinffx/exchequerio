import { Effect } from "effect";
import { TypeID } from "typeid-js";
import { describe, expect, it } from "vitest";
import { INT64_MAX } from "@/lib/amounts";
import { ConflictError } from "@/lib/errors";
import { newLedgerAccountID, newLedgerID, newOrgID } from "@/lib/ids";
import { LedgerAccount, LedgerAccountAssetMismatch } from "./LedgerAccount";

const asset = { assetId: new TypeID("ast").toString(), assetCode: "USD", minorUnitExponent: 2 };
const account = () =>
	LedgerAccount.fromCreateRequest(
		newLedgerAccountID(),
		newOrgID(),
		newLedgerID(),
		{ name: "Cash", normalBalance: "debit", assetId: asset.assetId },
		asset
	);
const entry = (amount: bigint) => ({
	assetId: asset.assetId,
	amount,
	direction: "debit" as const,
	status: "posted" as const,
});

describe("Asset account balances", () => {
	it("keeps amounts above Number precision exact through persistence and response conversion", () => {
		const amount = 9007199254740993n;
		const recorded = Effect.runSync(account().record(entry(amount)));
		expect(recorded.toRow().postedAmount).toBe(amount);
		expect(recorded.toResponse().balances[1]?.amount).toBe("9007199254740993");
		expect(recorded.toResponse()).toMatchObject(asset);
	});
	it("rejects an Entry for another Asset", () => {
		const error = Effect.runSync(
			Effect.flip(account().record({ ...entry(1n), assetId: new TypeID("ast").toString() }))
		);
		expect(error).toBeInstanceOf(LedgerAccountAssetMismatch);
	});
	it("allows exact intermediate overflow and validates the final projections", () => {
		const first = Effect.runSync(account().record(entry(INT64_MAX)));
		const intermediate = Effect.runSync(first.record(entry(1n)));
		expect(() => intermediate.assertBalancesInRange()).toThrow(ConflictError);
		const final = intermediate.remove(entry(1n));
		expect(() => final.assertBalancesInRange()).not.toThrow();
		expect(final.postedAmount).toBe(INT64_MAX);
	});
});
