import type { MonitorJob } from "./BalanceMonitorJob";

export const monitorJob: MonitorJob = {
	eventId: "event",
	monitorId: "monitor",
	monitorVersion: 1,
	organizationId: "org",
	ledgerId: "ledger",
	accountId: "account",
	accountVersion: 2,
	transactionId: "transaction",
	occurredAt: "2026-09-10T10:00:00.000Z",
	assetId: "asset",
	assetCode: "USD",
	minorUnitExponent: 2,
	before: { posted: "0", pending: "0", availableBalance: "0" },
	after: { posted: "1", pending: "1", availableBalance: "1" },
	alertCondition: {
		mode: "all",
		conditions: [{ balanceType: "posted", operator: ">", value: "0" }],
	},
	webhookUrl: "https://secret.example/hook",
	webhookSigningSecret: "encrypted-secret",
};
