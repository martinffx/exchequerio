import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/domains/ledgers/accounts/balance-monitors/MonitorSecrets";
import {
	sendWebhook,
	WebhookDeliveryError,
} from "@/domains/ledgers/accounts/balance-monitors/MonitorWebhook";
import { JobStore, MemoryJobStore, Worker } from "effect-mq";
import {
	BalanceMonitorJob,
	MonitorPublisher,
	monitorPublisherLayer,
	type MonitorJob,
} from "./BalanceMonitorJob";
import { monitorJob as job } from "./fixtures";

const handle = (payload: MonitorJob, encryptionKey: string, send: typeof sendWebhook) =>
	BalanceMonitorJob.handle(payload, encryptionKey, send).pipe(
		Effect.provideService(Worker.CurrentJob, {
			jobId: JobStore.JobId("job"),
			name: "balance-monitor-delivery",
			queue: JobStore.QueueName("balance-monitor-delivery"),
			attempt: 1,
			attemptsMax: 12,
		})
	);

const enqueueJobs = (jobs: readonly MonitorJob[]) =>
	Effect.gen(function* () {
		yield* (yield* MonitorPublisher)(jobs);
	}).pipe(Effect.provide(monitorPublisherLayer));

const key = Buffer.alloc(32, 1).toString("base64");
const payload: typeof BalanceMonitorJob.payloadSchema.Type = {
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

describe("BalanceMonitorJob", () => {
	it("completes non-crossings without decrypting or sending", async () => {
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		expect(
			await Effect.runPromise(
				handle({ ...payload, after: payload.before, webhookSigningSecret: "invalid" }, "invalid", send)
			)
		).toEqual({ matched: false });
		expect(send).not.toHaveBeenCalled();
	});

	it("delivers the immutable historical rule and balances with a stable event ID across retries", async () => {
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		expect(await Effect.runPromise(handle(payload, key, send))).toEqual({ matched: true });
		await Effect.runPromise(handle(payload, key, send));
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
		expect(await Effect.runPromise(handle(payload, key, send).pipe(Effect.flip))).toMatchObject({
			reason: "http",
			status: 503,
		});
	});

	it("fails permanently on invalid encrypted credentials without sending", async () => {
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		expect(
			await Effect.runPromise(
				handle({ ...payload, webhookSigningSecret: "invalid-secret" }, key, send).pipe(Effect.flip)
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
		BalanceMonitorJob.handle(payload, key, send).pipe(
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
	expect(BalanceMonitorJob.retryable?.({ reason: "http", status })).toBe(retryable);
});

it.each([
	["dns", true],
	["network", true],
	["timeout", true],
	["interrupted", true],
	["credentials", false],
	["destination", false],
] as const)("classifies %s failures for automatic retries", (reason, retryable) => {
	expect(BalanceMonitorJob.retryable?.({ reason })).toBe(retryable);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("best-effort monitor publication", () => {
	it("enqueues captured jobs and skips empty batches", async () => {
		const enqueue = vi.spyOn(BalanceMonitorJob, "enqueueMany");
		await Effect.runPromise(enqueueJobs([]).pipe(Effect.provide(MemoryJobStore.layer)));
		expect(enqueue).not.toHaveBeenCalled();
		await Effect.runPromise(enqueueJobs([job]).pipe(Effect.provide(MemoryJobStore.layer)));
		expect(enqueue).toHaveBeenCalledWith([job]);
	});
	it.each(["failure", "defect", "timeout"])(
		"logs an unconfirmed %s without failing accounting or leaking secrets",
		async kind => {
			vi.useFakeTimers();
			vi
				.spyOn(BalanceMonitorJob, "enqueueMany")
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
				enqueueJobs([job, { ...job, accountId: "second-account", eventId: "second-event" }]).pipe(
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
			expect(BalanceMonitorJob.enqueueMany).toHaveBeenCalledTimes(kind === "defect" ? 1 : 5);
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
	const original = BalanceMonitorJob.enqueueMany.bind(BalanceMonitorJob);
	const enqueue = vi.spyOn(BalanceMonitorJob, "enqueueMany").mockImplementation(jobs => {
		times.push(Date.now());
		return times.length < 5
			? Effect.die(new JobStore.JobStoreError({ message: "offline" }))
			: original(jobs);
	});
	const running = Effect.runPromise(enqueueJobs([job]).pipe(Effect.provide(MemoryJobStore.layer)));
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
	vi.spyOn(BalanceMonitorJob, "enqueueMany").mockReturnValue(
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
	const original = BalanceMonitorJob.enqueueMany.bind(BalanceMonitorJob);
	let attempts = 0;
	vi
		.spyOn(BalanceMonitorJob, "enqueueMany")
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
		await runtime.runPromise(enqueueJobs([job]));
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
