import { randomUUID } from "node:crypto";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { Job, JobStore, Worker } from "effect-mq";
import { Redis as IoRedis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BalanceMonitorJob } from "./BalanceMonitorJob";
import { monitorJob } from "./fixtures";
import { WebhookDeliveryError } from "@/domains/ledgers/accounts/balance-monitors/MonitorWebhook";
import { makeMonitorJobStore } from "./MonitorQueue";

class QueueTestJob extends Job.make("monitor-queue-test", {
	payload: { eventId: Schema.String },
	success: Schema.String,
	error: Schema.String,
	queue: "test",
	idempotencyKey: ({ eventId }) => eventId,
	defaults: { attempts: 2, backoff: { type: "fixed", delay: "300 millis" } },
}) {}

const valkeyUrl = process.env.VALKEY_URL ?? "redis://127.0.0.1:6379";

describe("MonitorQueue with Valkey", () => {
	let prefix: string;
	let storeLayer: ReturnType<typeof makeMonitorJobStore>;
	let runtime: ReturnType<typeof ManagedRuntime.make<JobStore.JobStore, never>>;
	const workers: Array<{ dispose: () => Promise<void> }> = [];

	beforeEach(() => {
		prefix = `monitor-queue-test-${randomUUID()}`;
		storeLayer = makeMonitorJobStore(valkeyUrl, { prefix });
		runtime = ManagedRuntime.make(storeLayer);
	});

	afterEach(async () => {
		await Promise.all(workers.splice(0).map(worker => worker.dispose()));
		await runtime.dispose();
		const cleanup = new IoRedis(valkeyUrl, { maxRetriesPerRequest: 1 });
		try {
			let cursor = "0";
			do {
				const [next, keys] = await cleanup.scan(cursor, "MATCH", `${prefix}:*`, "COUNT", 100);
				cursor = next;
				if (keys.length > 0) await cleanup.del(...keys);
			} while (cursor !== "0");
		} finally {
			cleanup.disconnect();
		}
	});

	const startWorker = async (
		handler: (eventId: string, attempt: number) => Effect.Effect<string, string>
	) => {
		const worker = ManagedRuntime.make(
			QueueTestJob.toLayer(
				({ eventId }) =>
					Effect.gen(function* () {
						const current = yield* Worker.CurrentJob;
						return yield* handler(eventId, current.attempt);
					}),
				{ concurrency: 1 }
			).pipe(
				Layer.provide(Worker.layer({ pollInterval: "20 millis", stalledInterval: "20 millis" })),
				Layer.provide(storeLayer)
			)
		);
		workers.push(worker);
		await worker.runPromise(Effect.void);
		return worker;
	};

	const record = (id: JobStore.JobId) =>
		runtime.runPromise(
			Effect.gen(function* () {
				return yield* (yield* JobStore.JobStore).getJob(id);
			})
		);
	const waitForState = (id: JobStore.JobId, state: JobStore.JobState) =>
		vi.waitFor(
			async () => {
				expect(Option.getOrThrow(await record(id)).state).toBe(state);
			},
			{ timeout: 5000, interval: 10 }
		);

	it.each([
		[400, "failed"],
		[503, "delayed"],
	] as const)("applies the monitor retry policy for HTTP %s", async (status, state) => {
		const worker = ManagedRuntime.make(
			BalanceMonitorJob.toLayer(
				() => Effect.fail(new WebhookDeliveryError({ reason: "http", status })),
				{ concurrency: 1 }
			).pipe(Layer.provide(Worker.layer({ pollInterval: "20 millis" })), Layer.provide(storeLayer))
		);
		workers.push(worker);
		await worker.runPromise(Effect.void);
		const id = await runtime.runPromise(BalanceMonitorJob.enqueue(monitorJob));
		await waitForState(id, state);
		expect(
			(await runtime.runPromise(BalanceMonitorJob.attempts(id))).map(attempt => attempt.outcome)
		).toEqual([state === "failed" ? "failed" : "retried"]);
	});

	it("deduplicates concurrent and completed event publication", async () => {
		const ids = await Promise.all(
			Array.from({ length: 8 }, () =>
				runtime.runPromise(QueueTestJob.enqueue({ eventId: "duplicate" }))
			)
		);
		expect(new Set(ids).size).toBe(1);
		const id = ids[0]!;
		await startWorker(eventId => Effect.succeed(eventId));
		await waitForState(id, "completed");
		expect(await runtime.runPromise(QueueTestJob.enqueue({ eventId: "duplicate" }))).toBe(id);
		expect(await runtime.runPromise(QueueTestJob.attempts(id))).toHaveLength(1);
	});

	it("persists delayed retries across worker restarts", async () => {
		const worker = await startWorker((eventId, attempt) =>
			attempt === 1 ? Effect.fail("retry") : Effect.succeed(eventId)
		);
		const id = await runtime.runPromise(QueueTestJob.enqueue({ eventId: "retry" }));
		await waitForState(id, "delayed");
		await worker.dispose();
		await startWorker(eventId => Effect.succeed(eventId));
		await waitForState(id, "completed");
		expect(
			(await runtime.runPromise(QueueTestJob.attempts(id))).map(attempt => attempt.outcome)
		).toEqual(["retried", "completed"]);
	});

	it("retains exhausted jobs and permits explicit replay", async () => {
		let failing = true;
		await startWorker(eventId => (failing ? Effect.fail("unavailable") : Effect.succeed(eventId)));
		const id = await runtime.runPromise(QueueTestJob.enqueue({ eventId: "failure" }));
		await waitForState(id, "failed");
		expect(
			(await runtime.runPromise(QueueTestJob.attempts(id))).map(attempt => attempt.outcome)
		).toEqual(["retried", "failed"]);
		failing = false;
		await runtime.runPromise(QueueTestJob.retry(id));
		await waitForState(id, "completed");
	});

	it("recovers an expired claim and rejects acknowledgement from its former owner", async () => {
		const id = await runtime.runPromise(QueueTestJob.enqueue({ eventId: "crash" }));
		const store = await runtime.runPromise(JobStore.JobStore);
		const claim = await runtime.runPromise(
			store.claim({
				queue: JobStore.QueueName("test"),
				names: ["monitor-queue-test"],
				token: "dead-worker",
				lockDurationMs: 30,
			})
		);
		expect(claim._tag).toBe("Claimed");
		await vi.waitFor(
			async () => {
				expect(await runtime.runPromise(store.recoverStalled({ maxStalledCount: 2 }))).toEqual([
					{ id, failed: false },
				]);
			},
			{ timeout: 5000, interval: 10 }
		);
		await expect(
			runtime.runPromise(
				store.ack(id, "dead-worker", { _tag: "Complete", exit: { _tag: "Success", value: "done" } })
			)
		).rejects.toThrow();
		await startWorker(eventId => Effect.succeed(eventId));
		await waitForState(id, "completed");
		expect(
			(await runtime.runPromise(QueueTestJob.attempts(id))).map(attempt => attempt.outcome)
		).toEqual(["stalled", "completed"]);
	});

	it("sweeps terminal history by state without expiring unfinished work", async () => {
		await runtime.dispose();
		storeLayer = makeMonitorJobStore(valkeyUrl, {
			prefix,
			historyTtl: { completed: "100 millis", cancelled: "100 millis", failed: "500 millis" },
			historySweepInterval: "20 millis",
		});
		runtime = ManagedRuntime.make(storeLayer);
		const store = await runtime.runPromise(JobStore.JobStore);
		const ids: JobStore.JobId[] = [];
		for (const outcome of ["Complete", "Fail", "Cancelled"] as const) {
			const id = await runtime.runPromise(QueueTestJob.enqueue({ eventId: outcome }));
			ids.push(id);
			await runtime.runPromise(
				store.claim({
					queue: JobStore.QueueName("test"),
					names: ["monitor-queue-test"],
					token: outcome,
					lockDurationMs: 5000,
				})
			);
			await runtime.runPromise(
				store.ack(id, outcome, { _tag: outcome, exit: { _tag: "Success", value: "done" } })
			);
		}
		const pending = await runtime.runPromise(
			QueueTestJob.enqueue({ eventId: "unfinished" }, { delay: "1 hour" })
		);
		await vi.waitFor(
			async () => {
				expect(Option.isNone(await record(ids[0]!))).toBe(true);
				expect(Option.isNone(await record(ids[2]!))).toBe(true);
			},
			{ timeout: 5000, interval: 10 }
		);
		expect(Option.getOrThrow(await record(ids[1]!)).state).toBe("failed");
		await vi.waitFor(async () => expect(Option.isNone(await record(ids[1]!))).toBe(true), {
			timeout: 5000,
			interval: 10,
		});
		expect(Option.getOrThrow(await record(pending)).state).toBe("delayed");
	});
});
