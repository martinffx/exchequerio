import { Effect, Queue } from "effect";
import { Client } from "pg";
import { MonitorDelivery } from "./MonitorDelivery";
import type { MonitorOutboxRepoLive } from "./MonitorOutboxRepo";

/** A confirmed queue write precedes removal of its durable PostgreSQL source. */
export const relayMonitorBatch = (
	repo: Pick<MonitorOutboxRepoLive, "claimBatch" | "revisionsFor" | "acknowledge" | "cleanup">
) =>
	Effect.gen(function* () {
		const events = yield* repo.claimBatch();
		for (const event of events) {
			const revisions = yield* repo.revisionsFor(event);
			for (const revision of revisions) {
				yield* MonitorDelivery.enqueue({
					eventId: event.id,
					monitorId: revision.monitorId,
					monitorVersion: revision.version,
					organizationId: event.organizationId,
					ledgerId: event.ledgerId,
					accountId: event.accountId,
					accountVersion: event.accountVersion,
					transactionId: event.transactionId,
					occurredAt: event.occurredAt.toISOString(),
					currencyCode: event.currencyCode,
					before: event.before,
					after: event.after,
					alertCondition: revision.configuration.alertCondition,
					webhookUrl: revision.configuration.webhookUrl,
					webhookToken: revision.configuration.webhookToken,
				});
			}
			yield* repo.acknowledge(event.id, event.claimToken);
		}
		return events.length;
	});

export const runMonitorRelay = (
	repo: Pick<MonitorOutboxRepoLive, "claimBatch" | "revisionsFor" | "acknowledge" | "cleanup">,
	databaseUrl: string
) =>
	Effect.gen(function* () {
		const wake = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" });
		// Notifications only wake the relay. Startup, reconnect and timed scans recover missed signals.
		const listen = Effect.scoped(
			Effect.gen(function* () {
				const client = yield* Effect.acquireRelease(
					Effect.sync(
						() => new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 })
					),
					client => Effect.promise(() => client.end()).pipe(Effect.catchCause(() => Effect.void))
				);
				const disconnected = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" });
				client.on("error", () => Queue.offerUnsafe(disconnected, undefined));
				client.on("end", () => Queue.offerUnsafe(disconnected, undefined));
				client.on("notification", () => Queue.offerUnsafe(wake, undefined));
				yield* Effect.tryPromise(() => client.connect());
				yield* Effect.tryPromise(() => client.query("LISTEN balance_monitor_outbox"));
				yield* Queue.offer(wake, undefined);
				yield* Queue.take(disconnected);
			})
		).pipe(
			Effect.catchCause(() => Effect.logWarning("Monitor notification connection unavailable")),
			Effect.andThen(Effect.sleep("5 seconds")),
			Effect.forever
		);
		yield* Effect.forkScoped(listen);
		yield* Effect.gen(function* () {
			const count = yield* relayMonitorBatch(repo).pipe(
				Effect.catchCause(() =>
					Effect.logWarning("Monitor outbox relay failed; retained claims will be retried").pipe(
						Effect.as(0)
					)
				)
			);
			if (count === 50) return;
			yield* repo
				.cleanup()
				.pipe(Effect.catchCause(() => Effect.logWarning("Monitor revision cleanup failed")));
			yield* Effect.race(Queue.take(wake), Effect.sleep("30 seconds"));
		}).pipe(Effect.forever);
	});
