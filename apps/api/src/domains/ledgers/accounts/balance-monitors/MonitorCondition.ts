import type { AlertCondition, BalanceSnapshot } from "./LedgerAccountBalanceMonitorSchema";

const matches = (condition: AlertCondition, balances: BalanceSnapshot): boolean => {
	const compare = (item: AlertCondition["conditions"][number]): boolean => {
		const amount = balances[item.balanceType];
		switch (item.operator) {
			case "=":
				return amount === item.value;
			case "!=":
				return amount !== item.value;
			case "<":
				return amount < item.value;
			case "<=":
				return amount <= item.value;
			case ">":
				return amount > item.value;
			case ">=":
				return amount >= item.value;
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
