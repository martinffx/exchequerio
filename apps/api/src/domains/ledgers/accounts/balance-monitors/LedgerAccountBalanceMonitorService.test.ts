import dns from "node:dns";
import https from "node:https";
import { Effect, Option, Layer, Logger, ManagedRuntime } from "effect";
import { DateTime } from "luxon";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
	newOrgID,
	newLedgerID,
	newLedgerAccountID,
	newLedgerAccountBalanceMonitorID,
} from "@/lib/ids";
import {
	LedgerAccountBalanceMonitor,
	type LedgerAccountBalanceMonitorRecord,
} from "./LedgerAccountBalanceMonitor";
import {
	LedgerAccountBalanceMonitorService,
	deliverBalanceMonitor,
	inspectBalanceMonitorJob,
	LedgerAccountBalanceMonitorPublisher,
	ledgerAccountBalanceMonitorPublisherLayer,
	sendWebhook,
} from "./LedgerAccountBalanceMonitorService";
import { type LedgerAccountBalanceMonitorRepo } from "./LedgerAccountBalanceMonitorRepo";
import {
	type LedgerAccountBalanceMonitorRequest,
	type AlertCondition,
	type BalanceSnapshot,
} from "./LedgerAccountBalanceMonitorSchema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { type ClientRequest, type IncomingMessage } from "node:http";
import { JobStore, MemoryJobStore, Worker } from "effect-mq";
import {
	LedgerAccountBalanceMonitorJob,
	type LedgerAccountBalanceMonitorJobPayload,
	WebhookDeliveryError,
} from "./LedgerAccountBalanceMonitorJob";
import { monitorJob } from "./fixtures";
const scope = {
	organizationId: newOrgID().toString(),
	ledgerId: newLedgerID().toString(),
	accountId: newLedgerAccountID().toString(),
};
const key = Buffer.alloc(32, 7).toString("base64");
const request: LedgerAccountBalanceMonitorRequest = {
	alertCondition: {
		mode: "all",
		conditions: [{ balanceType: "posted", operator: "<", value: "100" }],
	},
	webhook: {
		url: "https://example.com/hook",
		signingSecret: "whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
	},
	metadata: { team: "treasury" },
};
const record = Effect.runSync(
	LedgerAccountBalanceMonitor.fromRequest(
		newLedgerAccountBalanceMonitorID(),
		scope,
		request,
		DateTime.utc(),
		"ciphertext"
	)
);
const repo = () =>
	({
		listMonitors: vi.fn(() => Effect.succeed([record])),
		// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
		getMonitor: vi.fn(() => Effect.succeed(Option.some(record))),
		createMonitor: vi.fn((value: LedgerAccountBalanceMonitorRecord) => Effect.succeed(value)),
		updateMonitor: vi.fn<LedgerAccountBalanceMonitorRepo["updateMonitor"]>(() => {
			// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
			return Effect.succeed(Option.some(record));
		}),
		// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
		deleteMonitor: vi.fn(() => Effect.succeed(Option.some(undefined))),
	}) satisfies LedgerAccountBalanceMonitorRepo;
describe("Balance monitor service", () => {
	it("encrypts credentials and returns real configuration without secrets", async () => {
		const repository = repo();
		const service = new LedgerAccountBalanceMonitorService(repository, key);
		const created = await Effect.runPromise(
			service.createLedgerAccountBalanceMonitor(scope, request)
		);
		expect(decryptSecret(created.row.webhookSigningSecret, key)).toBe(
			"whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
		);
		expect(created.toResponse()).toMatchObject({
			alertCondition: request.alertCondition,
			webhook: { url: request.webhook.url },
			lockVersion: 1,
			metadata: request.metadata,
		});
		expect(JSON.stringify(created.toResponse())).not.toContain("secret");
		expect(created.toResponse()).not.toHaveProperty("balances");
	});
	it("passes authenticated scope and preserves omitted signing secret on update", async () => {
		const repository = repo();
		const service = new LedgerAccountBalanceMonitorService(repository, key);
		await Effect.runPromise(
			service.updateLedgerAccountBalanceMonitor(scope, record.id.toString(), {
				...request,
				webhook: { url: request.webhook.url },
			})
		);
		expect(repository.updateMonitor.mock.calls[0]).toEqual([
			scope,
			record.id,
			{
				webhookUrl: request.webhook.url,
				description: undefined,
				alertCondition: request.alertCondition,
				metadata: JSON.stringify(request.metadata),
			},
			expect.any(Date),
		]);
	});
	it("encrypts a replacement signing secret on update", async () => {
		const repository = repo();
		const signingSecret = `whsec_${Buffer.alloc(32, 8).toString("base64")}`;
		await Effect.runPromise(
			new LedgerAccountBalanceMonitorService(repository, key).updateLedgerAccountBalanceMonitor(
				scope,
				record.id.toString(),
				{
					...request,
					webhook: { ...request.webhook, signingSecret },
				}
			)
		);
		const updated = repository.updateMonitor.mock.calls[0]!;
		expect(decryptSecret(updated[2].webhookSigningSecret!, key)).toBe(signingSecret);
	});

	it.each(["", "invalid"])("sanitizes invalid encryption configuration %s", async invalid => {
		const repository = repo();
		const error = await Effect.runPromise(
			Effect.flip(
				new LedgerAccountBalanceMonitorService(repository, invalid).createLedgerAccountBalanceMonitor(
					scope,
					request
				)
			)
		);
		expect(error).toMatchObject({
			statusCode: 503,
			message: "Balance monitor configuration unavailable",
		});
		expect(repository.createMonitor).not.toHaveBeenCalled();
	});
	it("rejects non-public webhook URLs before persistence", async () => {
		const repository = repo();
		const error = await Effect.runPromise(
			Effect.flip(
				new LedgerAccountBalanceMonitorService(repository, key).createLedgerAccountBalanceMonitor(
					scope,
					{ ...request, webhook: { ...request.webhook, url: "http://localhost" } }
				)
			)
		);
		expect(error).toMatchObject({ statusCode: 400 });
		expect(repository.createMonitor).not.toHaveBeenCalled();
	});
	it.each([
		"not-a-signing-key",
		"whsec_invalid",
		"whsec_" + Buffer.alloc(31).toString("base64"),
		"whsec_" + Buffer.alloc(32, 7).toString("base64").slice(0, -2) + "d=",
	])("rejects invalid signing secrets on create and update (%#)", async signingSecret => {
		const repository = repo();
		const service = new LedgerAccountBalanceMonitorService(repository, key);
		const invalid = { ...request, webhook: { ...request.webhook, signingSecret } };
		for (const action of [
			service.createLedgerAccountBalanceMonitor(scope, invalid),
			service.updateLedgerAccountBalanceMonitor(scope, record.id.toString(), invalid),
		]) {
			const error = await Effect.runPromise(Effect.flip(action));
			expect(error).toMatchObject({
				statusCode: 400,
				message: "Webhook signing secret must be whsec_ followed by a base64-encoded 32-byte key",
			});
			expect(error.message).not.toContain(signingSecret);
		}
		expect(repository.createMonitor).not.toHaveBeenCalled();
		expect(repository.updateMonitor).not.toHaveBeenCalled();
	});
	it("maps absent monitors to 404 and malformed IDs to 400", async () => {
		const repository = repo();
		repository.getMonitor.mockReturnValueOnce(Effect.succeed(Option.none()));
		const service = new LedgerAccountBalanceMonitorService(repository, key);
		expect(
			await Effect.runPromise(
				Effect.flip(service.getLedgerAccountBalanceMonitor(scope, record.id.toString()))
			)
		).toMatchObject({ statusCode: 404 });
		expect(
			await Effect.runPromise(Effect.flip(service.getLedgerAccountBalanceMonitor(scope, "invalid")))
		).toMatchObject({ statusCode: 400 });
	});
	it.each(["9223372036854775808", "-9223372036854775809", "01", "-0", "+1", " 1", "1e3", "1.0"])(
		"rejects invalid threshold %s on create and update",
		async value => {
			const repository = repo();
			const service = new LedgerAccountBalanceMonitorService(repository, key);
			const invalid = {
				...request,
				alertCondition: {
					...request.alertCondition,
					conditions: [{ ...request.alertCondition.conditions[0]!, value }],
				},
			};
			for (const action of [
				service.createLedgerAccountBalanceMonitor(scope, invalid),
				service.updateLedgerAccountBalanceMonitor(scope, record.id.toString(), invalid),
			]) {
				expect(await Effect.runPromise(Effect.flip(action))).toMatchObject({ statusCode: 400 });
			}
			expect(repository.createMonitor).not.toHaveBeenCalled();
			expect(repository.updateMonitor).not.toHaveBeenCalled();
		}
	);
	it.each(["9223372036854775807", "-9223372036854775808"])(
		"accepts int64 threshold %s",
		async value => {
			const repository = repo();
			const service = new LedgerAccountBalanceMonitorService(repository, key);
			const valid = {
				...request,
				alertCondition: {
					...request.alertCondition,
					conditions: [{ ...request.alertCondition.conditions[0]!, value }],
				},
			};
			expect(
				(await Effect.runPromise(service.createLedgerAccountBalanceMonitor(scope, valid))).toResponse()
					.alertCondition.conditions[0]!.value
			).toBe(value);
		}
	);
});

describe("Monitor processing", () => {
	/* oxlint-disable unicorn/no-null -- Node DNS callbacks require null for successful resolution. */

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
						handle(
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
				deliverBalanceMonitor(payload, key, { jobId: "job", attempt: 4 }, send).pipe(
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
				const enqueue = vi
					.spyOn(LedgerAccountBalanceMonitorJob, "enqueueMany")
					.mockReturnValue(Effect.succeed([]));
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

			const enqueue = vi
				.spyOn(LedgerAccountBalanceMonitorJob, "enqueueMany")
				.mockImplementation(() => {
					times.push(Date.now());
					return times.length < 5
						? Effect.die(new JobStore.JobStoreError({ message: "offline" }))
						: Effect.succeed([]);
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
	});

	describe("webhook transport", () => {
		const signingSecret = "whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
		const deliver = (url: string) =>
			deliverBalanceMonitor(
				{ ...monitorJob, webhookUrl: url, webhookSigningSecret: encryptSecret(signingSecret, key) },
				key,
				{ jobId: "job", attempt: 1 }
			);

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
			])("rejects unsafe target %s", async url => {
				await expect(
					Effect.runPromise(
						new LedgerAccountBalanceMonitorService(repo(), key).createLedgerAccountBalanceMonitor(scope, {
							...request,
							webhook: { ...request.webhook, url },
						})
					)
				).rejects.toThrow("Webhook URL must be a public HTTPS destination");
			});
			it.each([
				"https://example.com/path?event=1",
				"https://8.8.8.8",
				"https://[2606:4700:4700::1111]",
			])("accepts public HTTPS target %s", async url => {
				await Effect.runPromise(
					new LedgerAccountBalanceMonitorService(repo(), key).createLedgerAccountBalanceMonitor(scope, {
						...request,
						webhook: { ...request.webhook, url },
					})
				);
			});
		});

		describe("webhook delivery", () => {
			it("pins a public address and signs the transmitted JSON and refreshes the timestamp on retry", async () => {
				vi.spyOn(Date, "now").mockReturnValue(1700000000000);
				const { request, req } = transport(204);
				await Effect.runPromise(deliver("https://example.com/hook"));
				const options = request.mock.calls[0]?.[1] as https.RequestOptions;
				expect(options.headers).toMatchObject({
					"webhook-id": "event:monitor",
					"webhook-timestamp": "1700000000",
					"webhook-signature": `v1,${createHmac("sha256", Buffer.alloc(32, 7)).update(`event:monitor.1700000000.${req.end.mock.calls[0]?.[0]}`).digest("base64")}`,
					"Content-Type": "application/json",
				});
				expect(options.agent).toBe(false);
				const callback = vi.fn();
				options.lookup?.("example.com", { all: true }, callback);
				expect(callback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
				expect(JSON.parse(req.end.mock.calls[0]?.[0] as string)).toMatchObject({
					type: "balance_monitor.triggered",
					eventId: "event:monitor",
				});
				expect(options.headers).not.toHaveProperty("Authorization");
				vi.mocked(Date.now).mockReturnValue(1700000001000);
				await Effect.runPromise(deliver("https://example.com/hook"));
				const retried = request.mock.calls[1]?.[1] as https.RequestOptions;
				expect(retried.headers).toMatchObject({
					"webhook-id": "event:monitor",
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
					await expect(Effect.runPromise(deliver("https://example.com"))).rejects.toThrow(
						"Invalid webhook destination"
					);
					expect(request).not.toHaveBeenCalled();
				}
			);
			it("treats redirects as failed deliveries without following them", async () => {
				const { request } = transport(302);
				await expect(Effect.runPromise(deliver("https://example.com"))).rejects.toThrow(
					"Webhook returned HTTP 302"
				);
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
				const result = Effect.runPromise(deliver("https://example.com"));
				const assertion = expect(result).rejects.toThrow("Webhook delivery timed out");
				await vi.advanceTimersByTimeAsync(10_000);
				await assertion;
				completeLookup?.();
				expect(request).not.toHaveBeenCalled();
			});
			it("times out a connected receiver and destroys its request", async () => {
				vi.useFakeTimers();
				const { req } = transport();
				const result = Effect.runPromise(deliver("https://example.com"));
				const assertion = expect(result).rejects.toThrow("Webhook delivery timed out");
				await vi.advanceTimersByTimeAsync(10_000);
				await assertion;
				expect(req.destroy).toHaveBeenCalled();
			});
			it("aborts the request on interruption", async () => {
				const { req, request } = transport();
				const controller = new AbortController();
				const result = Effect.runPromise(deliver("https://example.com"), {
					signal: controller.signal,
				});
				await vi.waitFor(() => expect(request).toHaveBeenCalled());
				controller.abort();
				await expect(result).rejects.toThrow();
				expect(req.destroy).toHaveBeenCalled();
			});
			it("redacts native error messages", async () => {
				const { req, request } = transport();
				const result = Effect.runPromise(deliver("https://example.com"));
				await vi.waitFor(() => expect(request).toHaveBeenCalled());
				req.emit("error", new Error("private-token https://example.com"));
				await expect(result).rejects.toThrow("Webhook delivery failed");
			});
		});
	});
});

describe("Crossing decisions", () => {
	const crossed = (condition: AlertCondition, before: BalanceSnapshot, after: BalanceSnapshot) =>
		Effect.runSync(
			deliverBalanceMonitor(
				{
					...monitorJob,
					alertCondition: condition,
					before,
					after,
					webhookSigningSecret: encryptSecret(request.webhook.signingSecret!, key),
				},
				key,
				{ jobId: "job", attempt: 1 },
				() => Effect.void
			)
		).matched;

	describe("LedgerAccountBalanceMonitor.crossed", () => {
		it("emits once per crossing and rearms after recovery", () => {
			const states = ["120", "90", "80", "110", "90"];
			expect(
				states.slice(1).map((amount, i) => crossed(rule(), balances(states[i]!), balances(amount)))
			).toEqual([true, false, false, true]);
		});
		it("evaluates both snapshots independently of processing order", () => {
			expect(crossed(rule(), balances("110"), balances("90"))).toBe(true);
			expect(crossed(rule(), balances("90"), balances("110"))).toBe(false);
			expect(crossed(rule(), balances("120"), balances("90"))).toBe(true);
		});
		it.each(["posted", "pending", "availableBalance"] as const)(
			"selects the %s balance",
			balanceType => {
				expect(
					crossed(
						{ mode: "all", conditions: [{ balanceType, operator: "<", value: "0" }] },
						balances("0"),
						{
							...balances("0"),
							[balanceType]: "-1",
						}
					)
				).toBe(true);
			}
		);
		it.each([
			["=", 99, 100, true],
			["!=", 100, 101, true],
			["<", 101, 100, false],
			["<=", 101, 100, true],
			[">", 99, 100, false],
			[">=", 99, 100, true],
		] as const)("handles %s boundaries", (operator, before, after, expected) => {
			expect(crossed(rule(operator), balances(String(before)), balances(String(after)))).toBe(
				expected
			);
		});
		it("applies all/any to the complete condition rather than individual comparisons", () => {
			const conditions: AlertCondition["conditions"] = [
				{ balanceType: "posted", operator: "<", value: "100" },
				{ balanceType: "pending", operator: "<", value: "100" },
			];
			const before = { posted: "90", pending: "110", availableBalance: "0" };
			const after = { posted: "110", pending: "90", availableBalance: "0" };
			expect(crossed({ mode: "any", conditions }, before, after)).toBe(false);
			expect(crossed({ mode: "all", conditions }, before, balances("90"))).toBe(true);
		});
		it("does not alert for an already-matching starting balance or no net change", () => {
			expect(crossed(rule(), balances("80"), balances("70"))).toBe(false);
			expect(crossed(rule(), balances("80"), balances("80"))).toBe(false);
		});
		it("supports signed int64 extremes", () => {
			expect(
				crossed(rule("<", "0"), balances("9223372036854775807"), balances("-9223372036854775808"))
			).toBe(true);
		});
		it("compares adjacent values above Number precision exactly", () => {
			expect(
				crossed(
					rule(">", "9007199254740992"),
					balances("9007199254740992"),
					balances("9007199254740993")
				)
			).toBe(true);
			expect(crossed(rule("<", "10"), balances("10"), balances("9"))).toBe(true);
		});
	});
});

describe("Job adapter and operations", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});
	it.each([false, true])(
		"delegates the captured payload and attempt, propagating failure=%s",
		async fails => {
			const failure = new WebhookDeliveryError({ reason: "http", status: 503 });
			const deliver = vi.fn(() => (fails ? Effect.fail(failure) : Effect.succeed({ matched: true })));
			const attempt = {
				jobId: JobStore.JobId("job"),
				queue: JobStore.QueueName("balance-monitor-delivery"),
				name: "balance-monitor-delivery",
				attempt: 4,
				attemptsMax: 12,
			};
			const effect = LedgerAccountBalanceMonitorJob.handle(monitorJob, deliver).pipe(
				Effect.provideService(Worker.CurrentJob, attempt)
			);
			if (fails) expect(await Effect.runPromise(Effect.flip(effect))).toBe(failure);
			else expect(await Effect.runPromise(effect)).toEqual({ matched: true });
			expect(deliver).toHaveBeenCalledExactlyOnceWith(monitorJob, attempt);
		}
	);
	it("inspects only safe operational fields", async () => {
		const record = {
			id: "job",
			name: "balance-monitor-delivery",
			queue: "balance-monitor-delivery",
			state: "failed",
			attemptsMade: 12,
			attemptsMax: 12,
			enqueuedAt: 1,
			processedAt: 2,
			finishedAt: 3,
			payload: { secret: "private" },
			error: "private",
		};
		// oxlint-disable-next-line unicorn/no-array-callback-reference -- Effect Option constructor, not an iterator.
		const getJob = vi.fn(() => Effect.succeed(Option.some(record)));
		const result = await Effect.runPromise(
			inspectBalanceMonitorJob("job").pipe(
				Effect.provideService(JobStore.JobStore, { getJob } as never)
			)
		);
		expect(result).toEqual({
			id: "job",
			state: "failed",
			attemptsMade: 12,
			attemptsMax: 12,
			enqueuedAt: 1,
			processedAt: 2,
			finishedAt: 3,
		});
		expect(getJob).toHaveBeenCalledWith("job");
	});
	it.each(["missing", "foreign name", "foreign queue", "waiting", "completed", "failed"])(
		"handles replay eligibility for %s",
		async state => {
			const getJob = vi.fn(() =>
				Effect.succeed(
					state === "missing"
						? Option.none()
						: Option.some({
								name: state === "foreign name" ? "other" : "balance-monitor-delivery",
								queue: state === "foreign queue" ? "other" : "balance-monitor-delivery",
								state,
							})
				)
			);
			const retry = vi.spyOn(LedgerAccountBalanceMonitorJob, "retry").mockReturnValue(Effect.void);
			const effect = inspectBalanceMonitorJob("job", true).pipe(
				Effect.provideService(JobStore.JobStore, { getJob } as never)
			);
			if (state === "failed") {
				expect(await Effect.runPromise(effect)).toEqual({ id: "job", replayed: true });
				expect(retry).toHaveBeenCalledExactlyOnceWith("job");
			} else {
				expect(await Effect.runPromise(Effect.flip(effect))).toBe(
					["missing", "foreign name", "foreign queue"].includes(state)
						? "Monitor job not found"
						: "Only failed monitor jobs can be replayed"
				);
				expect(retry).not.toHaveBeenCalled();
			}
		}
	);
});

describe("Credential handling through monitor operations", () => {
	it("randomizes stored ciphertext and delivers with the configured secret", async () => {
		const service = new LedgerAccountBalanceMonitorService(repo(), key);
		const first = await Effect.runPromise(service.createLedgerAccountBalanceMonitor(scope, request));
		const second = await Effect.runPromise(service.createLedgerAccountBalanceMonitor(scope, request));
		expect(first.row.webhookSigningSecret).not.toBe(second.row.webhookSigningSecret);
		expect(first.row.webhookSigningSecret).not.toContain(request.webhook.signingSecret);
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		await Effect.runPromise(
			deliverBalanceMonitor(
				{ ...monitorJob, webhookSigningSecret: first.row.webhookSigningSecret },
				key,
				{ jobId: "job", attempt: 1 },
				send
			)
		);
		expect(send.mock.calls[0]?.[1]).toBe(request.webhook.signingSecret);
	});
	it.each(["tampered", "wrong key"])("rejects %s without sending", async failure => {
		const created = await Effect.runPromise(
			new LedgerAccountBalanceMonitorService(repo(), key).createLedgerAccountBalanceMonitor(
				scope,
				request
			)
		);
		const ciphertext = created.row.webhookSigningSecret;
		const send = vi.fn<typeof sendWebhook>(() => Effect.void);
		const result = await Effect.runPromise(
			Effect.flip(
				deliverBalanceMonitor(
					{
						...monitorJob,
						webhookSigningSecret: failure === "tampered" ? `${ciphertext.slice(0, -4)}AAAA` : ciphertext,
					},
					failure === "wrong key" ? Buffer.alloc(32, 8).toString("base64") : key,
					{ jobId: "job", attempt: 1 },
					send
				)
			)
		);
		expect(result).toMatchObject({ reason: "credentials" });
		expect(send).not.toHaveBeenCalled();
	});
	it.each([
		"",
		"secret",
		`whsec_${Buffer.alloc(31).toString("base64")}`,
		`whsec_${key}garbage`,
		`whsec_${key.slice(0, -1)}`,
	])("rejects malformed signing secret %# before persistence", async signingSecret => {
		const repository = repo();
		await expect(
			Effect.runPromise(
				new LedgerAccountBalanceMonitorService(repository, key).createLedgerAccountBalanceMonitor(
					scope,
					{ ...request, webhook: { ...request.webhook, signingSecret } }
				)
			)
		).rejects.toThrow("Webhook signing secret");
		expect(repository.createMonitor).not.toHaveBeenCalled();
	});
});

const handle = (
	payload: LedgerAccountBalanceMonitorJobPayload,
	encryptionKey: string,
	send: typeof sendWebhook
) =>
	deliverBalanceMonitor(payload, encryptionKey, { jobId: "job", attempt: 1 }, send).pipe(
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

const balances = (amount: string): BalanceSnapshot => ({
	posted: amount,
	pending: amount,
	availableBalance: amount,
});

const rule = (
	operator: AlertCondition["conditions"][number]["operator"] = "<",
	value = "100"
): AlertCondition => ({
	mode: "all",
	conditions: [{ balanceType: "availableBalance", operator, value }],
});
