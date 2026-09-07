import { parseAmount } from "@/lib/amounts";
import { Effect, Layer, Schema } from "effect";
import { Job, Worker } from "effect-mq";
import { crossed } from "@/domains/ledgers/accounts/balance-monitors/MonitorCondition";
import { decryptToken } from "@/domains/ledgers/accounts/balance-monitors/MonitorSecrets";
import { sendWebhook } from "@/domains/ledgers/accounts/balance-monitors/MonitorWebhook";

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
		webhookToken: Schema.String,
	},
	success: Schema.Struct({ matched: Schema.Boolean }),
	error: Schema.String,
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
		const token = yield* Effect.try({
			try: () => decryptToken(payload.webhookToken, encryptionKey),
			catch: () => "Unable to decrypt monitor token",
		});
		yield* send(payload.webhookUrl, token, {
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
		}).pipe(Effect.mapError(() => "Webhook delivery failed"));
		return { matched: true };
	});

export const makeMonitorDeliveryWorker = (encryptionKey: string) =>
	MonitorDelivery.toLayer(payload => deliverMonitorJob(payload, encryptionKey), {
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
