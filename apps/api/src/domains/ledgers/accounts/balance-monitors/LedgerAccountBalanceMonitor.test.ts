import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	newOrgID,
	newLedgerID,
	newLedgerAccountID,
	newLedgerAccountBalanceMonitorID,
} from "@/lib/ids";
import { describe, expect, it } from "vitest";
import type { AlertCondition, BalanceSnapshot } from "./LedgerAccountBalanceMonitorSchema";
import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";

const crossed = (condition: AlertCondition, before: BalanceSnapshot, after: BalanceSnapshot) =>
	LedgerAccountBalanceMonitor.fromConfiguration({ alertCondition: condition }).crossed(
		before,
		after
	);

const balances = (amount: string): BalanceSnapshot => ({
	posted: amount,
	pending: amount,
	availableBalance: amount,
});
const rule = (
	operator: AlertCondition["conditions"][number]["operator"] = "<",
	value = "100"
): AlertCondition => ({
	mode: "all",
	conditions: [{ balanceType: "availableBalance", operator, value }],
});
describe("LedgerAccountBalanceMonitor.crossed", () => {
	it("emits once per crossing and rearms after recovery", () => {
		const states = ["120", "90", "80", "110", "90"];
		expect(
			states.slice(1).map((amount, i) => crossed(rule(), balances(states[i]!), balances(amount)))
		).toEqual([true, false, false, true]);
	});
	it("evaluates both snapshots independently of processing order", () => {
		expect(crossed(rule(), balances("110"), balances("90"))).toBe(true);
		expect(crossed(rule(), balances("90"), balances("110"))).toBe(false);
		expect(crossed(rule(), balances("120"), balances("90"))).toBe(true);
	});
	it.each(["posted", "pending", "availableBalance"] as const)(
		"selects the %s balance",
		balanceType => {
			expect(
				crossed(
					{ mode: "all", conditions: [{ balanceType, operator: "<", value: "0" }] },
					balances("0"),
					{
						...balances("0"),
						[balanceType]: "-1",
					}
				)
			).toBe(true);
		}
	);
	it.each([
		["=", 99, 100, true],
		["!=", 100, 101, true],
		["<", 101, 100, false],
		["<=", 101, 100, true],
		[">", 99, 100, false],
		[">=", 99, 100, true],
	] as const)("handles %s boundaries", (operator, before, after, expected) => {
		expect(crossed(rule(operator), balances(String(before)), balances(String(after)))).toBe(expected);
	});
	it("applies all/any to the complete condition rather than individual comparisons", () => {
		const conditions: AlertCondition["conditions"] = [
			{ balanceType: "posted", operator: "<", value: "100" },
			{ balanceType: "pending", operator: "<", value: "100" },
		];
		const before = { posted: "90", pending: "110", availableBalance: "0" };
		const after = { posted: "110", pending: "90", availableBalance: "0" };
		expect(crossed({ mode: "any", conditions }, before, after)).toBe(false);
		expect(crossed({ mode: "all", conditions }, before, balances("90"))).toBe(true);
	});
	it("does not alert for an already-matching starting balance or no net change", () => {
		expect(crossed(rule(), balances("80"), balances("70"))).toBe(false);
		expect(crossed(rule(), balances("80"), balances("80"))).toBe(false);
	});
	it("supports signed int64 extremes", () => {
		expect(
			crossed(rule("<", "0"), balances("9223372036854775807"), balances("-9223372036854775808"))
		).toBe(true);
	});
	it("compares adjacent values above Number precision exactly", () => {
		expect(
			crossed(
				rule(">", "9007199254740992"),
				balances("9007199254740992"),
				balances("9007199254740993")
			)
		).toBe(true);
		expect(crossed(rule("<", "10"), balances("10"), balances("9"))).toBe(true);
	});
});

it("evaluates the condition of a persisted monitor without changing its representation", () => {
	const id = newLedgerAccountBalanceMonitorID();
	const accountId = newLedgerAccountID();
	const monitor = Effect.runSync(
		LedgerAccountBalanceMonitor.fromRequest(
			id,
			{
				organizationId: newOrgID().toString(),
				ledgerId: newLedgerID().toString(),
				accountId: accountId.toString(),
			},
			{
				alertCondition: rule(),
				webhook: { url: "https://example.com/hook", signingSecret: "unused" },
				metadata: { team: "treasury" },
			},
			DateTime.utc(2026, 9, 23),
			"encrypted-secret"
		)
	);
	expect(monitor.crossed(balances("110"), balances("90"))).toBe(true);
	expect(monitor.toResponse()).toMatchObject({
		id: id.toString(),
		accountId: accountId.toString(),
		alertCondition: rule(),
		metadata: { team: "treasury" },
	});
	expect(monitor.toCreateRow()).toBe(monitor.row);
});
