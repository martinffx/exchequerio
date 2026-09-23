import { Context, Effect, FiberSet, Layer, Schedule } from "effect";
import { JobStore } from "effect-mq";
import { MonitorDelivery } from "./MonitorDelivery";

export type MonitorJob = typeof MonitorDelivery.payloadSchema.Type;
export const MonitorPublisher =
	Context.Service<(jobs: readonly MonitorJob[]) => Effect.Effect<void>>("MonitorPublisher");

export const publishMonitorJobs = (jobs: readonly MonitorJob[]) => {
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
			return MonitorDelivery.enqueueMany([...jobs]);
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
						publishMonitorJobs(jobs).pipe(Effect.provideService(JobStore.JobStore, store))
					).pipe(Effect.asVoid);
	})
);
