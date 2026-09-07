import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { encryptToken } from "@/domains/ledgers/accounts/balance-monitors/MonitorSecrets";
import {
	sendWebhook,
	WebhookDeliveryError,
} from "@/domains/ledgers/accounts/balance-monitors/MonitorWebhook";
import { deliverMonitorJob, MonitorDelivery } from "./MonitorDelivery";

const key = Buffer.alloc(32, 1).toString("base64");
const payload: typeof MonitorDelivery.payloadSchema.Type = {
	eventId: "event-1",
	monitorId: "monitor-1",
	monitorVersion: 3,
	organizationId: "organization-1",
	ledgerId: "ledger-1",
	accountId: "account-1",
	accountVersion: 7,
	transactionId: "transaction-1",
	occurredAt: "2026-09-07T10:00:00.000Z",
	assetId: "ast_01h2x3y4z5a6b7c8d9e0f1g2h6",
	assetCode: "EUR",
	minorUnitExponent: 2,
	before: { posted: "100", pending: "100", availableBalance: "100" },
	after: { posted: "90", pending: "90", availableBalance: "90" },
	alertCondition: {
		mode: "all",
		conditions: [{ balanceType: "posted", operator: "<", value: "100" }],
	},
	webhookUrl: "https://example.com/hooks",
	webhookToken: encryptToken("caller-token", key),
};

describe("MonitorDelivery", () => {
	it("completes non-crossings without decrypting or sending", async () => {
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		expect(
			await Effect.runPromise(
				deliverMonitorJob(
					{ ...payload, after: payload.before, webhookToken: "invalid" },
					"invalid",
					send
				)
			)
		).toEqual({ matched: false });
		expect(send).not.toHaveBeenCalled();
	});

	it("delivers the immutable historical rule and balances with a stable event ID across retries", async () => {
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		expect(await Effect.runPromise(deliverMonitorJob(payload, key, send))).toEqual({ matched: true });
		await Effect.runPromise(deliverMonitorJob(payload, key, send));
		const { webhookUrl, webhookToken: _webhookToken, ...historical } = payload;
		expect(send).toHaveBeenNthCalledWith(1, webhookUrl, "caller-token", {
			...historical,
			type: "balance_monitor.triggered",
			eventId: "event-1:monitor-1",
		});
		expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
		expect(JSON.stringify(send.mock.calls[0]?.[2])).not.toContain("caller-token");
	});

	it("fails retryably and sanitizes delivery errors", async () => {
		const send = vi.fn<typeof sendWebhook>(() =>
			Effect.fail(new WebhookDeliveryError({ message: "caller-token https://secret.example" }))
		);
		expect(await Effect.runPromise(deliverMonitorJob(payload, key, send).pipe(Effect.flip))).toBe(
			"Webhook delivery failed"
		);
	});

	it("fails retryably on invalid encrypted credentials without sending", async () => {
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		expect(
			await Effect.runPromise(
				deliverMonitorJob({ ...payload, webhookToken: "invalid-secret" }, key, send).pipe(Effect.flip)
			)
		).toBe("Unable to decrypt monitor token");
		expect(send).not.toHaveBeenCalled();
	});
});
