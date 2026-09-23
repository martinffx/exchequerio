/* oxlint-disable unicorn/no-null -- Node DNS callbacks require null for successful resolution. */
import { createHmac, randomUUID } from "node:crypto";
import dns from "node:dns";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import { Effect, Layer, Logger, ManagedRuntime, Option, Schema } from "effect";
import { Job, JobStore, MemoryJobStore, Worker } from "effect-mq";
import { Redis as IoRedis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import {
	LedgerAccountBalanceMonitorJob,
	LedgerAccountBalanceMonitorPublisher,
	ledgerAccountBalanceMonitorPublisherLayer,
	type LedgerAccountBalanceMonitorJobPayload,
	sendWebhook,
	validateWebhookUrl,
	WebhookDeliveryError,
	makeLedgerAccountBalanceMonitorJobStore,
} from "./LedgerAccountBalanceMonitorJob";
import { monitorJob } from "./fixtures";

const handle = (
	payload: LedgerAccountBalanceMonitorJobPayload,
	encryptionKey: string,
	send: typeof sendWebhook
) =>
	LedgerAccountBalanceMonitorJob.handle(payload, encryptionKey, send).pipe(
		Effect.provideService(Worker.CurrentJob, {
			jobId: JobStore.JobId("job"),
			name: "balance-monitor-delivery",
			queue: JobStore.QueueName("balance-monitor-delivery"),
			attempt: 1,
			attemptsMax: 12,
		})
	);

const enqueueJobs = (jobs: readonly LedgerAccountBalanceMonitorJobPayload[]) =>
	Effect.gen(function* () {
		yield* (yield* LedgerAccountBalanceMonitorPublisher)(jobs);
	}).pipe(Effect.provide(ledgerAccountBalanceMonitorPublisherLayer));

function transport(
	status?: number,
	addresses: dns.LookupAddress[] = [{ address: "8.8.8.8", family: 4 }]
) {
	const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
	const response = Object.assign(new EventEmitter(), { statusCode: status, destroy: vi.fn() });
	const request = vi.spyOn(https, "request").mockImplementation((_url, _options, callback) => {
		if (status !== undefined)
			queueMicrotask(() => callback?.(response as unknown as IncomingMessage));
		return req as unknown as ClientRequest;
	});
	const lookup = vi.spyOn(dns, "lookup").mockImplementation(((
		_host: string,
		_options: dns.LookupAllOptions,
		callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void
	) => {
		callback(null, addresses);
	}) as typeof dns.lookup);
	return { req, response, request, lookup };
}

describe("job lifecycle", () => {
	const job = monitorJob;
	const key = Buffer.alloc(32, 1).toString("base64");
	const payload: typeof LedgerAccountBalanceMonitorJob.payloadSchema.Type = {
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

	describe("LedgerAccountBalanceMonitorJob", () => {
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
			LedgerAccountBalanceMonitorJob.handle(payload, key, send).pipe(
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
		expect(LedgerAccountBalanceMonitorJob.retryable?.({ reason: "http", status })).toBe(retryable);
	});

	it.each([
		["dns", true],
		["network", true],
		["timeout", true],
		["interrupted", true],
		["credentials", false],
		["destination", false],
	] as const)("classifies %s failures for automatic retries", (reason, retryable) => {
		expect(LedgerAccountBalanceMonitorJob.retryable?.({ reason })).toBe(retryable);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("best-effort monitor publication", () => {
		it("enqueues captured jobs and skips empty batches", async () => {
			const enqueue = vi.spyOn(LedgerAccountBalanceMonitorJob, "enqueueMany");
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
					.spyOn(LedgerAccountBalanceMonitorJob, "enqueueMany")
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
				expect(LedgerAccountBalanceMonitorJob.enqueueMany).toHaveBeenCalledTimes(
					kind === "defect" ? 1 : 5
				);
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
		const original = LedgerAccountBalanceMonitorJob.enqueueMany.bind(LedgerAccountBalanceMonitorJob);
		const enqueue = vi
			.spyOn(LedgerAccountBalanceMonitorJob, "enqueueMany")
			.mockImplementation(jobs => {
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
		vi.spyOn(LedgerAccountBalanceMonitorJob, "enqueueMany").mockReturnValue(
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
		const runtime = ManagedRuntime.make(
			ledgerAccountBalanceMonitorPublisherLayer.pipe(Layer.provide(store))
		);
		try {
			await runtime.runPromise(
				Effect.gen(function* () {
					yield* (yield* LedgerAccountBalanceMonitorPublisher)([job]);
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
		const original = LedgerAccountBalanceMonitorJob.enqueueMany.bind(LedgerAccountBalanceMonitorJob);
		let attempts = 0;
		vi
			.spyOn(LedgerAccountBalanceMonitorJob, "enqueueMany")
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
});

describe("webhook transport", () => {
	const signingSecret = "whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("webhook destination validation", () => {
		it.each([
			"http://example.com",
			"https://user:secret@example.com",
			"https://example.com/#fragment",
			"https://example.com/#",
			"https://127.0.0.1",
			"https://10.1.2.3",
			"https://172.31.0.1",
			"https://192.168.1.1",
			"https://169.254.169.254",
			"https://100.64.0.1",
			"https://0.0.0.0",
			"https://224.0.0.1",
			"https://192.0.2.1",
			"https://198.18.0.1",
			"https://240.0.0.1",
			"https://[::1]",
			"https://[fc00::1]",
			"https://[fe80::1]",
			"https://[::ffff:127.0.0.1]",
			"https://[2001:db8::1]",
			"https://[2002:7f00:1::]",
			"https://2130706433",
		])("rejects unsafe target %s", url => {
			expect(() => validateWebhookUrl(url)).toThrow("Invalid webhook destination");
		});
		it.each([
			"https://example.com/path?event=1",
			"https://8.8.8.8",
			"https://[2606:4700:4700::1111]",
		])("accepts public HTTPS target %s", url => {
			expect(() => validateWebhookUrl(url)).not.toThrow();
		});
	});

	describe("webhook delivery", () => {
		it("pins a public address and signs the transmitted JSON and refreshes the timestamp on retry", async () => {
			vi.spyOn(Date, "now").mockReturnValue(1700000000000);
			const { request, req } = transport(204);
			await Effect.runPromise(
				sendWebhook("https://example.com/hook", signingSecret, { eventId: "event" })
			);
			const options = request.mock.calls[0]?.[1] as https.RequestOptions;
			expect(options.headers).toMatchObject({
				"webhook-id": "event",
				"webhook-timestamp": "1700000000",
				"webhook-signature": `v1,${createHmac("sha256", Buffer.alloc(32, 7)).update('event.1700000000.{"eventId":"event"}').digest("base64")}`,
				"Content-Type": "application/json",
			});
			expect(options.agent).toBe(false);
			const callback = vi.fn();
			options.lookup?.("example.com", { all: true }, callback);
			expect(callback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
			expect(req.end).toHaveBeenCalledWith('{"eventId":"event"}');
			expect(options.headers).not.toHaveProperty("Authorization");
			vi.mocked(Date.now).mockReturnValue(1700000001000);
			await Effect.runPromise(
				sendWebhook("https://example.com/hook", signingSecret, { eventId: "event" })
			);
			const retried = request.mock.calls[1]?.[1] as https.RequestOptions;
			expect(retried.headers).toMatchObject({
				"webhook-id": "event",
				"webhook-timestamp": "1700000001",
			});
			expect(retried.headers).not.toEqual(options.headers);
		});
		it.each(["127.0.0.1", "::ffff:127.0.0.1", "fe80::1", "fd00::1"])(
			"rejects DNS results containing unsafe address %s",
			async address => {
				const { request } = transport(200, [
					{ address: "8.8.8.8", family: 4 },
					{ address, family: address.includes(":") ? 6 : 4 },
				]);
				await expect(
					Effect.runPromise(sendWebhook("https://example.com", signingSecret, { eventId: "event" }))
				).rejects.toThrow("Invalid webhook destination");
				expect(request).not.toHaveBeenCalled();
			}
		);
		it("treats redirects as failed deliveries without following them", async () => {
			const { request } = transport(302);
			await expect(
				Effect.runPromise(sendWebhook("https://example.com", signingSecret, { eventId: "event" }))
			).rejects.toThrow("Webhook returned HTTP 302");
			expect(request).toHaveBeenCalledOnce();
		});
		it("times out stalled DNS after ten seconds without sending a late request", async () => {
			vi.useFakeTimers();
			const { lookup, request } = transport();
			let completeLookup: (() => void) | undefined;
			lookup.mockImplementation(((
				_host: string,
				_options: dns.LookupAllOptions,
				callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void
			) => {
				completeLookup = () => callback(null, [{ address: "8.8.8.8", family: 4 }]);
			}) as typeof dns.lookup);
			const result = Effect.runPromise(
				sendWebhook("https://example.com", signingSecret, { eventId: "event" })
			);
			const assertion = expect(result).rejects.toThrow("Webhook delivery timed out");
			await vi.advanceTimersByTimeAsync(10_000);
			await assertion;
			completeLookup?.();
			expect(request).not.toHaveBeenCalled();
		});
		it("times out a connected receiver and destroys its request", async () => {
			vi.useFakeTimers();
			const { req } = transport();
			const result = Effect.runPromise(
				sendWebhook("https://example.com", signingSecret, { eventId: "event" })
			);
			const assertion = expect(result).rejects.toThrow("Webhook delivery timed out");
			await vi.advanceTimersByTimeAsync(10_000);
			await assertion;
			expect(req.destroy).toHaveBeenCalled();
		});
		it("aborts the request on interruption", async () => {
			const { req, request } = transport();
			const controller = new AbortController();
			const result = Effect.runPromise(
				sendWebhook("https://example.com", signingSecret, { eventId: "event" }),
				{
					signal: controller.signal,
				}
			);
			await vi.waitFor(() => expect(request).toHaveBeenCalled());
			controller.abort();
			await expect(result).rejects.toThrow();
			expect(req.destroy).toHaveBeenCalled();
		});
		it("redacts native error messages", async () => {
			const { req, request } = transport();
			const result = Effect.runPromise(
				sendWebhook("https://example.com", signingSecret, { eventId: "event" })
			);
			await vi.waitFor(() => expect(request).toHaveBeenCalled());
			req.emit("error", new Error("private-token https://example.com"));
			await expect(result).rejects.toThrow("Webhook delivery failed");
		});
	});
});

describe("queue integration", () => {
	class QueueTestJob extends Job.make("monitor-queue-test", {
		payload: { eventId: Schema.String },
		success: Schema.String,
		error: Schema.String,
		queue: "test",
		idempotencyKey: ({ eventId }) => eventId,
		defaults: { attempts: 2, backoff: { type: "fixed", delay: "300 millis" } },
	}) {}

	const valkeyUrl = process.env.VALKEY_URL ?? "redis://127.0.0.1:6379";

	describe("LedgerAccountBalanceMonitorJob with Valkey", () => {
		let prefix: string;
		let storeLayer: ReturnType<typeof makeLedgerAccountBalanceMonitorJobStore>;
		let runtime: ReturnType<typeof ManagedRuntime.make<JobStore.JobStore, never>>;
		const workers: Array<{ dispose: () => Promise<void> }> = [];

		beforeEach(() => {
			prefix = `monitor-queue-test-${randomUUID()}`;
			storeLayer = makeLedgerAccountBalanceMonitorJobStore(valkeyUrl, { prefix });
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
				LedgerAccountBalanceMonitorJob.toLayer(
					() => Effect.fail(new WebhookDeliveryError({ reason: "http", status })),
					{ concurrency: 1 }
				).pipe(Layer.provide(Worker.layer({ pollInterval: "20 millis" })), Layer.provide(storeLayer))
			);
			workers.push(worker);
			await worker.runPromise(Effect.void);
			const id = await runtime.runPromise(LedgerAccountBalanceMonitorJob.enqueue(monitorJob));
			await waitForState(id, state);
			expect(
				(await runtime.runPromise(LedgerAccountBalanceMonitorJob.attempts(id))).map(
					attempt => attempt.outcome
				)
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
			storeLayer = makeLedgerAccountBalanceMonitorJobStore(valkeyUrl, {
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
});
