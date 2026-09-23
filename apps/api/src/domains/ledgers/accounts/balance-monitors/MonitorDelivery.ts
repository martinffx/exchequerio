import { parseAmount } from "@/lib/amounts";
import { Effect, Layer, Schema } from "effect";
import { Job, Worker } from "effect-mq";
import { crossed } from "@/domains/ledgers/accounts/balance-monitors/MonitorCondition";
import { decryptSecret } from "@/domains/ledgers/accounts/balance-monitors/MonitorSecrets";
import {
	sendWebhook,
	WebhookFailure,
	WebhookDeliveryError,
	isRetryableWebhookFailure,
} from "@/domains/ledgers/accounts/balance-monitors/MonitorWebhook";

const amount = Schema.String.check(
	Schema.makeFilter<string>(value => {
		try {
			parseAmount(value);
			return true;
		} catch {
			return false;
		}
	})
);
const balanceSnapshot = Schema.Struct({
	posted: amount,
	pending: amount,
	availableBalance: amount,
});
const alertCondition = Schema.Struct({
	mode: Schema.Literals(["all", "any"]),
	conditions: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				balanceType: Schema.Literals(["posted", "pending", "availableBalance"]),
				operator: Schema.Literals(["=", "!=", "<", "<=", ">", ">="]),
				value: amount,
			})
		).check(Schema.isMinLength(1))
	),
});

export class MonitorDelivery extends Job.make("balance-monitor-delivery", {
	payload: {
		eventId: Schema.String,
		monitorId: Schema.String,
		monitorVersion: Schema.Int,
		organizationId: Schema.String,
		ledgerId: Schema.String,
		accountId: Schema.String,
		accountVersion: Schema.Int,
		transactionId: Schema.String,
		occurredAt: Schema.String,
		assetId: Schema.String,
		assetCode: Schema.String,
		minorUnitExponent: Schema.Int,
		before: balanceSnapshot,
		after: balanceSnapshot,
		alertCondition,
		webhookUrl: Schema.String,
		webhookSigningSecret: Schema.String,
	},
	success: Schema.Struct({ matched: Schema.Boolean }),
	error: WebhookFailure,
	retryable: isRetryableWebhookFailure,
	queue: "balance-monitor-delivery",
	idempotencyKey: ({ eventId, monitorId }) => `${eventId}:${monitorId}`,
	defaults: { attempts: 12, backoff: { type: "exponential", delay: "30 seconds", factor: 2 } },
}) {}

export const deliverMonitorJob = (
	payload: typeof MonitorDelivery.payloadSchema.Type,
	encryptionKey: string,
	send = sendWebhook
) =>
	Effect.gen(function* () {
		if (!crossed(payload.alertCondition, payload.before, payload.after)) return { matched: false };
		const secret = yield* Effect.try({
			try: () => decryptSecret(payload.webhookSigningSecret, encryptionKey),
			catch: () => new WebhookDeliveryError({ reason: "credentials" }),
		});
		yield* send(payload.webhookUrl, secret, {
			type: "balance_monitor.triggered",
			eventId: `${payload.eventId}:${payload.monitorId}`,
			monitorId: payload.monitorId,
			monitorVersion: payload.monitorVersion,
			organizationId: payload.organizationId,
			ledgerId: payload.ledgerId,
			accountId: payload.accountId,
			accountVersion: payload.accountVersion,
			transactionId: payload.transactionId,
			occurredAt: payload.occurredAt,
			assetId: payload.assetId,
			assetCode: payload.assetCode,
			minorUnitExponent: payload.minorUnitExponent,
			before: payload.before,
			after: payload.after,
			alertCondition: payload.alertCondition,
		});
		return { matched: true };
	});

export const handleMonitorDelivery = (
	payload: typeof MonitorDelivery.payloadSchema.Type,
	encryptionKey: string,
	send = sendWebhook
) =>
	Effect.gen(function* () {
		const job = yield* Worker.CurrentJob;
		return yield* deliverMonitorJob(payload, encryptionKey, send).pipe(
			Effect.tapError(error =>
				Effect.logError("monitor_delivery_failed", {
					jobId: job.jobId,
					eventId: payload.eventId,
					monitorId: payload.monitorId,
					attempt: job.attempt,
					reason: error.reason,
					...(error.status === undefined ? {} : { status: error.status }),
				})
			)
		);
	});

export const makeMonitorDeliveryWorker = (encryptionKey: string) =>
	MonitorDelivery.toLayer(payload => handleMonitorDelivery(payload, encryptionKey), {
		concurrency: 5,
	}).pipe(
		Layer.provide(
			Worker.layer({
				lockDuration: "30 seconds",
				lockRenewInterval: "10 seconds",
				pollInterval: "5 seconds",
			})
		)
	);
