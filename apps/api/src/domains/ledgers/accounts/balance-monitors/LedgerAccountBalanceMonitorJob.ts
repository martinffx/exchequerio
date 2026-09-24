import { Data, Effect, Layer, Schema } from "effect";
import { Job, Worker } from "effect-mq";
import type { RedisJobStore } from "effect-mq/redis";
import { parseAmount } from "@/lib/amounts";
import { makeJobStore } from "@/lib/queues";

export const WebhookFailure = Schema.Struct({
	reason: Schema.Literals([
		"dns",
		"network",
		"timeout",
		"interrupted",
		"destination",
		"credentials",
		"http",
	]),
	status: Schema.optional(Schema.Number),
});
export class WebhookDeliveryError extends Data.TaggedError("WebhookDeliveryError")<
	typeof WebhookFailure.Type
> {
	override get message(): string {
		switch (this.reason) {
			case "dns":
				return "Webhook DNS resolution failed";
			case "network":
				return "Webhook delivery failed";
			case "timeout":
				return "Webhook delivery timed out";
			case "interrupted":
				return "Webhook delivery interrupted";
			case "destination":
				return "Invalid webhook destination";
			case "credentials":
				return "Invalid webhook signing credentials";
			case "http":
				return `Webhook returned HTTP ${this.status}`;
		}
	}
}

export const isRetryableWebhookFailure = (error: typeof WebhookFailure.Type): boolean =>
	error.reason === "http"
		? error.status === 408 ||
			error.status === 429 ||
			(error.status !== undefined && error.status >= 500 && error.status < 600)
		: ["dns", "network", "timeout", "interrupted"].includes(error.reason);

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

export class LedgerAccountBalanceMonitorJob extends Job.make("balance-monitor-delivery", {
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
}) {
	static handle(
		payload: typeof LedgerAccountBalanceMonitorJob.payloadSchema.Type,
		deliver: (
			payload: LedgerAccountBalanceMonitorJobPayload,
			attempt: { readonly jobId: string; readonly attempt: number }
		) => Effect.Effect<{ matched: boolean }, WebhookDeliveryError>
	) {
		return Effect.flatMap(Worker.CurrentJob, attempt => deliver(payload, attempt));
	}
}

export const makeLedgerAccountBalanceMonitorJobWorker = (
	deliver: Parameters<typeof LedgerAccountBalanceMonitorJob.handle>[1]
) =>
	LedgerAccountBalanceMonitorJob.toLayer(
		payload => LedgerAccountBalanceMonitorJob.handle(payload, deliver),
		{
			concurrency: 5,
		}
	).pipe(
		Layer.provide(
			Worker.layer({
				lockDuration: "30 seconds",
				lockRenewInterval: "10 seconds",
				pollInterval: "5 seconds",
			})
		)
	);

export type LedgerAccountBalanceMonitorJobPayload =
	typeof LedgerAccountBalanceMonitorJob.payloadSchema.Type;
type LedgerAccountBalanceMonitorQueueOptions = Pick<
	RedisJobStore.RedisJobStoreOptions,
	"prefix" | "historyTtl" | "historySweepInterval"
>;

export const makeLedgerAccountBalanceMonitorJobStore = (
	valkeyUrl: string,
	options: LedgerAccountBalanceMonitorQueueOptions = {}
) =>
	makeJobStore(valkeyUrl, {
		prefix: "exchequer-balance-monitors",
		historyTtl: { completed: "1 day", failed: "7 days", cancelled: "1 day" },
		historySweepInterval: "1 minute",
		...options,
	});
