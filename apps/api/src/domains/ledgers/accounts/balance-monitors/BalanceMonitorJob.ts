import { parseAmount } from "@/lib/amounts";
import { Context, Effect, FiberSet, Layer, Schedule, Schema } from "effect";
import { Job, JobStore, Worker } from "effect-mq";
import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
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

export class BalanceMonitorJob extends Job.make("balance-monitor-delivery", {
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
		payload: typeof BalanceMonitorJob.payloadSchema.Type,
		encryptionKey: string,
		send = sendWebhook
	) {
		return Effect.gen(function* () {
			const job = yield* Worker.CurrentJob;
			return yield* Effect.gen(function* () {
				const monitor = LedgerAccountBalanceMonitor.fromConfiguration(payload);
				if (!monitor.crossed(payload.before, payload.after)) return { matched: false };
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
			}).pipe(
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
	}
}

export const makeBalanceMonitorJobWorker = (encryptionKey: string) =>
	BalanceMonitorJob.toLayer(payload => BalanceMonitorJob.handle(payload, encryptionKey), {
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

export type MonitorJob = typeof BalanceMonitorJob.payloadSchema.Type;
export const MonitorPublisher =
	Context.Service<(jobs: readonly MonitorJob[]) => Effect.Effect<void>>("MonitorPublisher");

const enqueueMonitorJobs = (jobs: readonly MonitorJob[]) => {
	if (jobs.length === 0) return Effect.void;
	return Effect.gen(function* () {
		let attempts = 0;
		const logFailure = (reason: string) =>
			Effect.logError("monitor_enqueue_failed", {
				reason,
				attempts,
				outcome: "unconfirmed",
				transactionIds: [...new Set(jobs.map(job => job.transactionId))],
				accountIds: [...new Set(jobs.map(job => job.accountId))],
				jobIds: jobs.map(job => `balance-monitor-delivery/${job.eventId}:${job.monitorId}`),
			});
		yield* Effect.suspend(() => {
			attempts++;
			return BalanceMonitorJob.enqueueMany([...jobs]);
		}).pipe(
			// effect-mq promotes store failures to defects; only these are retryable.
			Effect.catchDefect(defect =>
				JobStore.isJobStoreError(defect) ? Effect.fail(defect) : Effect.die(defect)
			),
			Effect.timeout("5 seconds"),
			Effect.retry({ times: 4, schedule: Schedule.exponential("100 millis").pipe(Schedule.jittered) }),
			Effect.catchTag("TimeoutError", () => logFailure("timeout")),
			Effect.catchCause(() => logFailure("enqueue_error"))
		);
	});
};

export const monitorPublisherLayer = Layer.effect(
	MonitorPublisher,
	Effect.gen(function* () {
		const store = yield* JobStore.JobStore;
		const tasks = yield* FiberSet.make<void, never>();
		// Registered after FiberSet.make so draining precedes fiber interruption and store disposal.
		yield* Effect.addFinalizer(() => FiberSet.awaitEmpty(tasks));
		return (jobs: readonly MonitorJob[]) =>
			jobs.length === 0
				? Effect.void
				: FiberSet.run(
						tasks,
						enqueueMonitorJobs(jobs).pipe(Effect.provideService(JobStore.JobStore, store))
					).pipe(Effect.asVoid);
	})
);
