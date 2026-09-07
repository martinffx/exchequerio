import { describe, expect, it } from "vitest";
import type { AlertCondition, BalanceSnapshot } from "./LedgerAccountBalanceMonitorSchema";
import { crossed } from "./MonitorCondition";

const balances = (amount: number): BalanceSnapshot => ({
	posted: amount,
	pending: amount,
	availableBalance: amount,
});
const rule = (
	operator: AlertCondition["conditions"][number]["operator"] = "<",
	value = 100
): AlertCondition => ({
	mode: "all",
	conditions: [{ balanceType: "availableBalance", operator, value }],
});
describe("Balance monitor crossings", () => {
	it("emits once per crossing and rearms after recovery", () => {
		const states = [120, 90, 80, 110, 90];
		expect(
			states.slice(1).map((amount, i) => crossed(rule(), balances(states[i]!), balances(amount)))
		).toEqual([true, false, false, true]);
	});
	it("evaluates both snapshots independently of processing order", () => {
		expect(crossed(rule(), balances(110), balances(90))).toBe(true);
		expect(crossed(rule(), balances(90), balances(110))).toBe(false);
		expect(crossed(rule(), balances(120), balances(90))).toBe(true);
	});
	it.each(["posted", "pending", "availableBalance"] as const)(
		"selects the %s balance",
		balanceType => {
			expect(
				crossed({ mode: "all", conditions: [{ balanceType, operator: "<", value: 0 }] }, balances(0), {
					...balances(0),
					[balanceType]: -1,
				})
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
		expect(crossed(rule(operator), balances(before), balances(after))).toBe(expected);
	});
	it("applies all/any to the complete condition rather than individual comparisons", () => {
		const conditions: AlertCondition["conditions"] = [
			{ balanceType: "posted", operator: "<", value: 100 },
			{ balanceType: "pending", operator: "<", value: 100 },
		];
		const before = { posted: 90, pending: 110, availableBalance: 0 };
		const after = { posted: 110, pending: 90, availableBalance: 0 };
		expect(crossed({ mode: "any", conditions }, before, after)).toBe(false);
		expect(crossed({ mode: "all", conditions }, before, balances(90))).toBe(true);
	});
	it("does not alert for an already-matching starting balance or no net change", () => {
		expect(crossed(rule(), balances(80), balances(70))).toBe(false);
		expect(crossed(rule(), balances(80), balances(80))).toBe(false);
	});
	it("supports safe integer extremes", () => {
		expect(
			crossed(rule("<", 0), balances(Number.MAX_SAFE_INTEGER), balances(Number.MIN_SAFE_INTEGER))
		).toBe(true);
	});
});
