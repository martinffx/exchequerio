import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { JobStore, MemoryJobStore } from "effect-mq";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonitorDelivery } from "./MonitorDelivery";
import { MonitorPublisher, monitorPublisherLayer, publishMonitorJobs } from "./MonitorPublisher";

import { monitorJob as job } from "./fixtures";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("best-effort monitor publication", () => {
	it("enqueues captured jobs and skips empty batches", async () => {
		const enqueue = vi.spyOn(MonitorDelivery, "enqueueMany");
		await Effect.runPromise(publishMonitorJobs([]).pipe(Effect.provide(MemoryJobStore.layer)));
		expect(enqueue).not.toHaveBeenCalled();
		await Effect.runPromise(publishMonitorJobs([job]).pipe(Effect.provide(MemoryJobStore.layer)));
		expect(enqueue).toHaveBeenCalledWith([job]);
	});
	it.each(["failure", "defect", "timeout"])(
		"logs an unconfirmed %s without failing accounting or leaking secrets",
		async kind => {
			vi.useFakeTimers();
			vi
				.spyOn(MonitorDelivery, "enqueueMany")
				.mockReturnValue(
					kind === "timeout"
						? Effect.never
						: kind === "defect"
							? Effect.die("encrypted-secret https://secret.example/hook")
							: Effect.fail(
									new JobStore.JobStoreError({ message: "encrypted-secret https://secret.example/hook" })
								).pipe(Effect.orDie)
				);
			const logs: unknown[] = [];
			const logger = Logger.make(entry => {
				logs.push(entry.message);
			});
			const running = Effect.runPromise(
				publishMonitorJobs([
					job,
					{ ...job, accountId: "second-account", eventId: "second-event" },
				]).pipe(
					Effect.provide(
						Layer.merge(MemoryJobStore.layer, Logger.layer([logger], { mergeWithExisting: false }))
					)
				)
			);
			await vi.advanceTimersByTimeAsync(27000);
			await running;
			expect(logs).toHaveLength(1);
			expect(logs[0]).toEqual([
				"monitor_enqueue_failed",
				expect.objectContaining({ attempts: kind === "defect" ? 1 : 5 }),
			]);
			expect(MonitorDelivery.enqueueMany).toHaveBeenCalledTimes(kind === "defect" ? 1 : 5);
			expect(JSON.stringify(logs)).toContain("monitor_enqueue_failed");
			expect(JSON.stringify(logs)).toContain("transaction");
			expect(JSON.stringify(logs)).toContain("unconfirmed");
			expect(JSON.stringify(logs)).toContain("second-account");
			expect(JSON.stringify(logs)).toContain("balance-monitor-delivery/second-event:monitor");
			expect(JSON.stringify(logs)).toContain(kind === "timeout" ? "timeout" : "enqueue_error");
			expect(JSON.stringify(logs)).not.toContain("encrypted-secret");
			expect(JSON.stringify(logs)).not.toContain("secret.example");
		}
	);
});

it("retries store failures with exponential backoff and jitter, retaining the batch", async () => {
	vi.useFakeTimers();
	const times: number[] = [];
	const original = MonitorDelivery.enqueueMany.bind(MonitorDelivery);
	const enqueue = vi.spyOn(MonitorDelivery, "enqueueMany").mockImplementation(jobs => {
		times.push(Date.now());
		return times.length < 5
			? Effect.die(new JobStore.JobStoreError({ message: "offline" }))
			: original(jobs);
	});
	const running = Effect.runPromise(
		publishMonitorJobs([job]).pipe(Effect.provide(MemoryJobStore.layer))
	);
	await vi.advanceTimersByTimeAsync(2000);
	await running;
	expect(times).toHaveLength(5);
	for (let i = 1; i < times.length; i++) {
		const delay = times[i]! - times[i - 1]!;
		const nominal = 100 * 2 ** (i - 1);
		expect(delay).toBeGreaterThanOrEqual(nominal * 0.8 - 1);
		expect(delay).toBeLessThanOrEqual(nominal * 1.2 + 1);
	}
	for (const [batch] of enqueue.mock.calls) expect(batch).toEqual([job]);
});

it("returns before enqueue finishes and drains background tasks before releasing the store", async () => {
	let finish!: () => void;
	const pending = new Promise<void>(resolve => {
		finish = resolve;
	});
	const started = vi.fn<() => void>();
	const completed = vi.fn<() => void>();
	const released = vi.fn<() => void>();
	vi.spyOn(MonitorDelivery, "enqueueMany").mockReturnValue(
		Effect.gen(function* () {
			started();
			yield* Effect.promise(() => pending);
			completed();
			return [];
		})
	);
	const store = Layer.effect(
		JobStore.JobStore,
		Effect.gen(function* () {
			const store = yield* JobStore.JobStore;
			yield* Effect.addFinalizer(() => Effect.sync(released));
			return store;
		})
	).pipe(Layer.provide(MemoryJobStore.layer));
	const runtime = ManagedRuntime.make(monitorPublisherLayer.pipe(Layer.provide(store)));
	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				yield* (yield* MonitorPublisher)([job]);
			})
		);
		await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
		expect(completed).not.toHaveBeenCalled();
		const closing = runtime.dispose();
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(released).not.toHaveBeenCalled();
		finish();
		await closing;
		expect(completed).toHaveBeenCalledOnce();
		expect(released).toHaveBeenCalledOnce();
	} finally {
		finish();
		await runtime.dispose();
	}
});

it("deduplicates retry after a batch was accepted but acknowledgement was lost", async () => {
	const original = MonitorDelivery.enqueueMany.bind(MonitorDelivery);
	let attempts = 0;
	vi
		.spyOn(MonitorDelivery, "enqueueMany")
		.mockImplementation(jobs =>
			original(jobs).pipe(
				Effect.flatMap(ids =>
					++attempts === 1
						? Effect.die(new JobStore.JobStoreError({ message: "acknowledgement lost" }))
						: Effect.succeed(ids)
				)
			)
		);
	const runtime = ManagedRuntime.make(MemoryJobStore.layer);
	try {
		await runtime.runPromise(publishMonitorJobs([job]));
		expect(attempts).toBe(2);
		const ids = await runtime.runPromise(original([job]));
		expect(ids).toEqual(["balance-monitor-delivery/event:monitor"]);
		const stored = await runtime.runPromise(
			Effect.gen(function* () {
				return yield* (yield* JobStore.JobStore).getJob(ids[0]!);
			})
		);
		expect(stored).toMatchObject({ value: { state: "waiting" } });
	} finally {
		await runtime.dispose();
	}
});
