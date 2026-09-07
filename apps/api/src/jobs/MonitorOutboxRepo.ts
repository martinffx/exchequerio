import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { EffectDrizzleDatabase } from "@/db";
import {
	BalanceMonitorOutboxTable as outbox,
	BalanceMonitorRevisionsTable as revisions,
	LedgerAccountBalanceMonitorsTable as monitors,
} from "@/db/schema";

type MonitorEvent = typeof outbox.$inferSelect;
export type ClaimedMonitorEvent = MonitorEvent & { claimToken: string };
type EventRevisionScope = Pick<
	MonitorEvent,
	"organizationId" | "ledgerId" | "accountId" | "accountVersion"
>;

export class MonitorOutboxRepoLive {
	constructor(private readonly db: EffectDrizzleDatabase) {}

	claimBatch(limit = 50) {
		return this.db.transaction(tx =>
			Effect.gen(function* () {
				const selected = yield* tx
					.select({ id: outbox.id })
					.from(outbox)
					.where(or(isNull(outbox.claimUntil), lt(outbox.claimUntil, sql`now()`)))
					.orderBy(asc(outbox.created), asc(outbox.id))
					.limit(limit)
					.for("update", { skipLocked: true });
				if (selected.length === 0) return [] as ClaimedMonitorEvent[];
				const claimToken = randomUUID();
				const claimed = yield* tx
					.update(outbox)
					.set({ claimToken, claimUntil: sql`now() + interval '60 seconds'` })
					.where(
						inArray(
							outbox.id,
							selected.map(row => row.id)
						)
					)
					.returning();
				return claimed.map(row => ({ ...row, claimToken }));
			})
		);
	}

	revisionsFor(event: EventRevisionScope) {
		return this.db
			.select({ revision: revisions })
			.from(revisions)
			.innerJoin(
				monitors,
				and(eq(monitors.id, revisions.monitorId), eq(monitors.accountId, revisions.accountId))
			)
			.where(
				and(
					eq(revisions.accountId, event.accountId),
					eq(monitors.organizationId, event.organizationId),
					eq(monitors.ledgerId, event.ledgerId),
					lt(revisions.startVersion, event.accountVersion),
					or(isNull(revisions.endVersion), gte(revisions.endVersion, event.accountVersion))
				)
			)
			.pipe(Effect.map(rows => rows.map(row => row.revision)));
	}

	acknowledge(eventId: string, claimToken: string) {
		return this.db
			.delete(outbox)
			.where(and(eq(outbox.id, eventId), eq(outbox.claimToken, claimToken)))
			.returning({ id: outbox.id })
			.pipe(Effect.map(rows => rows.length === 1));
	}

	release(eventId: string, claimToken: string) {
		return this.db
			.update(outbox)
			.set({ claimToken: sql`null`, claimUntil: sql`null` })
			.where(and(eq(outbox.id, eventId), eq(outbox.claimToken, claimToken)))
			.returning({ id: outbox.id })
			.pipe(Effect.map(rows => rows.length === 1));
	}

	cleanup(accountId?: string) {
		return this.db.transaction(tx =>
			Effect.gen(function* () {
				yield* tx.delete(revisions).where(
					and(
						isNotNull(revisions.endVersion),
						accountId ? eq(revisions.accountId, accountId) : undefined,
						notExists(
							tx
								.select({ id: outbox.id })
								.from(outbox)
								.where(
									and(
										eq(outbox.accountId, revisions.accountId),
										lt(revisions.startVersion, outbox.accountVersion),
										gte(revisions.endVersion, outbox.accountVersion)
									)
								)
						)
					)
				);
				yield* tx
					.delete(monitors)
					.where(
						and(
							isNotNull(monitors.deletedAt),
							accountId ? eq(monitors.accountId, accountId) : undefined,
							notExists(
								tx
									.select({ monitorId: revisions.monitorId })
									.from(revisions)
									.where(eq(revisions.monitorId, monitors.id))
							)
						)
					);
			})
		);
	}
}
