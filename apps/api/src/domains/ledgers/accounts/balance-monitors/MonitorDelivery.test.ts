import { Effect, Logger } from "effect";
import { describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/domains/ledgers/accounts/balance-monitors/MonitorSecrets";
import {
	sendWebhook,
	WebhookDeliveryError,
} from "@/domains/ledgers/accounts/balance-monitors/MonitorWebhook";
import { JobStore, Worker } from "effect-mq";
import { deliverMonitorJob, handleMonitorDelivery, MonitorDelivery } from "./MonitorDelivery";

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
	webhookSigningSecret: encryptSecret("whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=", key),
};

describe("MonitorDelivery", () => {
	it("completes non-crossings without decrypting or sending", async () => {
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		expect(
			await Effect.runPromise(
				deliverMonitorJob(
					{ ...payload, after: payload.before, webhookSigningSecret: "invalid" },
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
		const { webhookUrl, webhookSigningSecret: _webhookSigningSecret, ...historical } = payload;
		expect(send).toHaveBeenNthCalledWith(
			1,
			webhookUrl,
			"whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
			{
				...historical,
				type: "balance_monitor.triggered",
				eventId: "event-1:monitor-1",
			}
		);
		expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
		expect(JSON.stringify(send.mock.calls[0]?.[2])).not.toContain(
			"whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
		);
	});

	it("preserves safe HTTP failure details", async () => {
		const send = vi.fn<typeof sendWebhook>(() =>
			Effect.fail(new WebhookDeliveryError({ reason: "http", status: 503 }))
		);
		expect(
			await Effect.runPromise(deliverMonitorJob(payload, key, send).pipe(Effect.flip))
		).toMatchObject({ reason: "http", status: 503 });
	});

	it("fails permanently on invalid encrypted credentials without sending", async () => {
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		expect(
			await Effect.runPromise(
				deliverMonitorJob({ ...payload, webhookSigningSecret: "invalid-secret" }, key, send).pipe(
					Effect.flip
				)
			)
		).toMatchObject({ reason: "credentials" });
		expect(send).not.toHaveBeenCalled();
	});
});

it("logs a sanitized delivery failure with the actual worker attempt", async () => {
	const messages: unknown[] = [];
	const logger = Logger.make(entry => {
		messages.push(entry.message);
	});
	const send = vi.fn<typeof sendWebhook>(() =>
		Effect.fail(new WebhookDeliveryError({ reason: "http", status: 503 }))
	);
	const failure = await Effect.runPromise(
		handleMonitorDelivery(payload, key, send).pipe(
			Effect.provideService(Worker.CurrentJob, {
				jobId: JobStore.JobId("job"),
				name: "balance-monitor-delivery",
				queue: JobStore.QueueName("balance-monitor-delivery"),
				attempt: 4,
				attemptsMax: 12,
			}),
			Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
			Effect.flip
		)
	);
	expect(failure).toMatchObject({ reason: "http", status: 503 });
	expect(messages).toEqual([
		[
			"monitor_delivery_failed",
			{
				jobId: "job",
				eventId: payload.eventId,
				monitorId: payload.monitorId,
				attempt: 4,
				reason: "http",
				status: 503,
			},
		],
	]);
	expect(JSON.stringify(messages)).not.toContain(
		"whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
	);
	expect(JSON.stringify(messages)).not.toContain("secret.example");
	expect(JSON.stringify(messages)).not.toContain(payload.webhookSigningSecret);
});

it.each([
	[400, false],
	[401, false],
	[403, false],
	[404, false],
	[408, true],
	[429, true],
	[500, true],
	[503, true],
	[302, false],
])("classifies HTTP %s for automatic retries", (status, retryable) => {
	expect(MonitorDelivery.retryable?.({ reason: "http", status })).toBe(retryable);
});

it.each([
	["dns", true],
	["network", true],
	["timeout", true],
	["interrupted", true],
	["credentials", false],
	["destination", false],
] as const)("classifies %s failures for automatic retries", (reason, retryable) => {
	expect(MonitorDelivery.retryable?.({ reason })).toBe(retryable);
});
