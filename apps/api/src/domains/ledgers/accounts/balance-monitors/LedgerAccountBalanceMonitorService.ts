/* oxlint-disable unicorn/no-null -- Node DNS callbacks require null for successful resolution. */
import dns from "node:dns";
import type { ClientRequest } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { JobStore } from "effect-mq";
import { parseAmount } from "@/lib/amounts";
import { Clock, Context, Effect, FiberSet, Layer, Option, Schedule } from "effect";
import { DateTime } from "luxon";
import { BadRequestError, ServiceUnavailableError } from "@/lib/errors";
import { encodeMetadata, parseId } from "@/lib/utils";
import {
	newLedgerAccountBalanceMonitorID,
	type LedgerAccountBalanceMonitorID,
	type LedgerAccountID,
	type LedgerID,
} from "@/lib/ids";
import { LedgerAccountBalanceMonitor, type MonitorScope } from "./LedgerAccountBalanceMonitor";
import { LedgerAccountBalanceMonitorNotFound } from "./LedgerAccountBalanceMonitorErrors";
import {
	type LedgerAccountBalanceMonitorRepo,
	LedgerAccountBalanceMonitorRepoTag,
} from "./LedgerAccountBalanceMonitorRepo";
import type {
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorUpdateRequest,
} from "./LedgerAccountBalanceMonitorSchema";
import { decodeSigningSecret, encryptSecret, decryptSecret, signWebhook } from "@/lib/crypto";
import {
	LedgerAccountBalanceMonitorJob,
	WebhookDeliveryError,
	type WebhookFailure,
	type LedgerAccountBalanceMonitorJobPayload,
} from "./LedgerAccountBalanceMonitorJob";
const serverTime = Clock.currentTimeMillis.pipe(
	Effect.map(milliseconds => DateTime.fromMillis(milliseconds, { zone: "utc" }))
);
const parseScope = (scope: MonitorScope) =>
	Effect.all([
		parseId<"lgr", LedgerID>("lgr", scope.ledgerId),
		parseId<"lat", LedgerAccountID>("lat", scope.accountId),
	]).pipe(Effect.as(scope));
const requireFound =
	<A>(id: LedgerAccountBalanceMonitorID) =>
	(value: Option.Option<A>) =>
		Option.match(value, {
			onNone: () => Effect.fail(new LedgerAccountBalanceMonitorNotFound(id)),
			onSome: Effect.succeed,
		});
export class LedgerAccountBalanceMonitorService {
	constructor(
		private readonly repository: LedgerAccountBalanceMonitorRepo,
		private readonly encryptionKey: string
	) {}
	private webhook(request: LedgerAccountBalanceMonitorUpdateRequest) {
		return Effect.gen({ self: this }, function* () {
			yield* Effect.try({
				try: () => {
					for (const condition of request.alertCondition.conditions) parseAmount(condition.value);
				},
				catch: error => error as BadRequestError,
			});
			yield* Effect.try({
				try: () => validateWebhookUrl(request.webhook.url),
				catch: () => new BadRequestError("Webhook URL must be a public HTTPS destination"),
			});
			const signingSecret = request.webhook.signingSecret;
			if (signingSecret !== undefined) {
				yield* Effect.try({
					try: () => decodeSigningSecret(signingSecret),
					catch: () =>
						new BadRequestError(
							"Webhook signing secret must be whsec_ followed by a base64-encoded 32-byte key"
						),
				});
			}
			const encrypted = yield* Effect.try({
				try: () => encryptSecret(signingSecret ?? "", this.encryptionKey),
				catch: () => new ServiceUnavailableError("Balance monitor configuration unavailable"),
			});
			return {
				webhookUrl: request.webhook.url,
				...(signingSecret === undefined ? {} : { webhookSigningSecret: encrypted }),
			};
		});
	}
	listLedgerAccountBalanceMonitors(scope: MonitorScope, offset: number, limit: number) {
		return parseScope(scope).pipe(
			Effect.flatMap(() => this.repository.listMonitors(scope, { offset, limit }))
		);
	}
	getLedgerAccountBalanceMonitor(scope: MonitorScope, id: string) {
		return Effect.gen({ self: this }, function* () {
			yield* parseScope(scope);
			const monitorId = yield* parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", id);
			return yield* this.repository
				.getMonitor(scope, monitorId)
				.pipe(Effect.flatMap(requireFound(monitorId)));
		});
	}
	createLedgerAccountBalanceMonitor(
		scope: MonitorScope,
		request: LedgerAccountBalanceMonitorRequest
	) {
		return Effect.gen({ self: this }, function* () {
			yield* parseScope(scope);
			const webhook = yield* this.webhook(request);
			const time = yield* serverTime;
			const record = yield* LedgerAccountBalanceMonitor.fromRequest(
				newLedgerAccountBalanceMonitorID(),
				scope,
				request,
				time,
				webhook.webhookSigningSecret!
			);
			return yield* this.repository.createMonitor(record);
		});
	}
	updateLedgerAccountBalanceMonitor(
		scope: MonitorScope,
		id: string,
		request: LedgerAccountBalanceMonitorUpdateRequest
	) {
		return Effect.gen({ self: this }, function* () {
			yield* parseScope(scope);
			const monitorId = yield* parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", id);
			const webhook = yield* this.webhook(request);
			const time = yield* serverTime;
			return yield* this.repository
				.updateMonitor(
					scope,
					monitorId,
					{
						...webhook,
						description: request.description,
						alertCondition: request.alertCondition,
						metadata: encodeMetadata(request.metadata),
					},
					time.toJSDate()
				)
				.pipe(Effect.flatMap(requireFound(monitorId)));
		});
	}
	deleteLedgerAccountBalanceMonitor(scope: MonitorScope, id: string) {
		return Effect.gen({ self: this }, function* () {
			yield* parseScope(scope);
			const monitorId = yield* parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", id);
			return yield* this.repository
				.deleteMonitor(scope, monitorId)
				.pipe(Effect.flatMap(requireFound(monitorId)));
		});
	}
}
export const LedgerAccountBalanceMonitorServiceTag =
	Context.Service<LedgerAccountBalanceMonitorService>("LedgerAccountBalanceMonitorService");
export const ledgerAccountBalanceMonitorServiceLayer = (encryptionKey: string) =>
	Layer.effect(
		LedgerAccountBalanceMonitorServiceTag,
		LedgerAccountBalanceMonitorRepoTag.pipe(
			Effect.map(repository => new LedgerAccountBalanceMonitorService(repository, encryptionKey))
		)
	);

const reservedV4 = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	reservedV4.addSubnet(address, prefix, "ipv4");

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const reservedV6 = new BlockList();
// Exclude special-purpose, documentation and transition ranges. IPv4-mapped,
// local and multicast addresses are outside the global-unicast allowlist.
reservedV6.addSubnet("2001::", 23, "ipv6");
reservedV6.addSubnet("2001:db8::", 32, "ipv6");
reservedV6.addSubnet("2002::", 16, "ipv6");
reservedV6.addSubnet("3fff::", 20, "ipv6");

const isPublicAddress = (address: string): boolean => {
	const family = isIP(address);
	return family === 4
		? !reservedV4.check(address, "ipv4")
		: family === 6 && globalV6.check(address, "ipv6") && !reservedV6.check(address, "ipv6");
};

const hostname = (url: URL): string => url.hostname.replace(/^\[|\]$/g, "");

export const validateWebhookUrl = (value: string): void => {
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			value.includes("#") ||
			(isIP(hostname(url)) !== 0 && !isPublicAddress(hostname(url)))
		)
			throw new Error();
	} catch {
		throw new Error("Invalid webhook destination");
	}
};

export const sendWebhook = (
	url: string,
	signingSecret: string,
	payload: { readonly eventId: string; readonly [key: string]: unknown }
): Effect.Effect<void, WebhookDeliveryError> =>
	Effect.tryPromise({
		try: signal =>
			new Promise<void>((resolve, reject) => {
				let request: ClientRequest | undefined;
				let finished = false;
				const finish = (reason?: (typeof WebhookFailure.Type)["reason"], status?: number) => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					signal.removeEventListener("abort", abort);
					request?.destroy();
					if (reason)
						reject(new WebhookDeliveryError({ reason, ...(status === undefined ? {} : { status }) }));
					else resolve();
				};
				const abort = () => finish("interrupted");
				const timer = setTimeout(() => finish("timeout"), 10_000);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) {
					abort();
					return;
				}

				let target: URL;
				try {
					validateWebhookUrl(url);
					target = new URL(url);
				} catch {
					finish("destination");
					return;
				}
				const send = (addresses: dns.LookupAddress[]) => {
					if (finished) return;
					const selected = addresses[0];
					if (!selected || !addresses.every(({ address }) => isPublicAddress(address))) {
						finish("destination");
						return;
					}
					const body = JSON.stringify(payload);
					const timestamp = Math.floor(Date.now() / 1000);
					let signature: string;
					try {
						signature = signWebhook(signingSecret, payload.eventId, timestamp, body);
					} catch {
						finish("credentials");
						return;
					}
					try {
						request = https.request(
							target,
							{
								method: "POST",
								agent: false,
								// Preserve the original hostname for TLS verification; never resolve it twice.
								lookup: (_host, options, callback) => {
									if (options.all) callback(null, [selected]);
									else callback(null, selected.address, selected.family);
								},
								headers: {
									"webhook-id": payload.eventId,
									"webhook-timestamp": String(timestamp),
									"webhook-signature": signature,
									"Content-Type": "application/json",
									"Content-Length": Buffer.byteLength(body),
								},
							},
							response => {
								const status = response.statusCode ?? 0;
								// Delivery is acknowledged by status; never retain or log receiver bodies.
								response.destroy();
								finish(status >= 200 && status < 300 ? undefined : "http", status);
							}
						);
						request.on("error", () => finish("network"));
						request.end(body);
					} catch {
						finish("network");
					}
				};
				const host = hostname(target);
				const family = isIP(host);
				if (family) send([{ address: host, family }]);
				else {
					try {
						dns.lookup(host, { all: true }, (error, addresses) => {
							if (error) finish("dns");
							else send(addresses);
						});
					} catch {
						finish("dns");
					}
				}
			}),
		catch: error =>
			error instanceof WebhookDeliveryError ? error : new WebhookDeliveryError({ reason: "network" }),
	});

export const deliverBalanceMonitor = (
	payload: LedgerAccountBalanceMonitorJobPayload,
	encryptionKey: string,
	job: { readonly jobId: string; readonly attempt: number },
	send = sendWebhook
) => {
	return Effect.gen(function* () {
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
};
export const LedgerAccountBalanceMonitorPublisher = Context.Service<
	(jobs: readonly LedgerAccountBalanceMonitorJobPayload[]) => Effect.Effect<void>
>("LedgerAccountBalanceMonitorPublisher");

const enqueueMonitorJobs = (jobs: readonly LedgerAccountBalanceMonitorJobPayload[]) => {
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
			return LedgerAccountBalanceMonitorJob.enqueueMany([...jobs]);
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

export const ledgerAccountBalanceMonitorPublisherLayer = Layer.effect(
	LedgerAccountBalanceMonitorPublisher,
	Effect.gen(function* () {
		const store = yield* JobStore.JobStore;
		const tasks = yield* FiberSet.make<void, never>();
		// Registered after FiberSet.make so draining precedes fiber interruption and store disposal.
		yield* Effect.addFinalizer(() => FiberSet.awaitEmpty(tasks));
		return (jobs: readonly LedgerAccountBalanceMonitorJobPayload[]) =>
			jobs.length === 0
				? Effect.void
				: FiberSet.run(
						tasks,
						enqueueMonitorJobs(jobs).pipe(Effect.provideService(JobStore.JobStore, store))
					).pipe(Effect.asVoid);
	})
);

export const inspectBalanceMonitorJob = (rawId: string, replay = false) =>
	Effect.gen(function* () {
		const store = yield* JobStore.JobStore;
		const id = JobStore.JobId(rawId);
		const found = yield* store.getJob(id);
		if (
			Option.isNone(found) ||
			found.value.name !== "balance-monitor-delivery" ||
			found.value.queue !== "balance-monitor-delivery"
		)
			return yield* Effect.fail("Monitor job not found");
		const job = found.value;
		if (replay) {
			if (job.state !== "failed")
				return yield* Effect.fail("Only failed monitor jobs can be replayed");
			yield* LedgerAccountBalanceMonitorJob.retry(id);
			return { id, replayed: true };
		}
		return {
			id,
			state: job.state,
			attemptsMade: job.attemptsMade,
			attemptsMax: job.attemptsMax,
			enqueuedAt: job.enqueuedAt,
			processedAt: job.processedAt,
			finishedAt: job.finishedAt,
		};
	});
