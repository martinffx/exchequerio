import { parseAmount } from "@/lib/amounts";
import type { AlertCondition, BalanceSnapshot } from "./LedgerAccountBalanceMonitorSchema";

const matches = (condition: AlertCondition, balances: BalanceSnapshot): boolean => {
	const compare = (item: AlertCondition["conditions"][number]): boolean => {
		const amount = parseAmount(balances[item.balanceType]);
		const threshold = parseAmount(item.value);
		switch (item.operator) {
			case "=":
				return amount === threshold;
			case "!=":
				return amount !== threshold;
			case "<":
				return amount < threshold;
			case "<=":
				return amount <= threshold;
			case ">":
				return amount > threshold;
			case ">=":
				return amount >= threshold;
		}
	};
	return condition.mode === "all"
		? condition.conditions.every(compare)
		: condition.conditions.some(compare);
};

/** A complete accounting mutation is one transition, independent of worker arrival order. */
export const crossed = (
	condition: AlertCondition,
	before: BalanceSnapshot,
	after: BalanceSnapshot
): boolean => !matches(condition, before) && matches(condition, after);
