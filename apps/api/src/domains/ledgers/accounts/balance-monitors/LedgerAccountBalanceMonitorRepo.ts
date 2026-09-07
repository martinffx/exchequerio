import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import { NotFoundError } from "@/lib/errors";
import type { LedgerAccountBalanceMonitorID } from "@/repo/entities/types";
import {
	BalanceMonitorRevisionsTable as revisions,
	LedgerAccountBalanceMonitorsTable as monitors,
	LedgerAccountsTable as accounts,
	type LedgerAccountBalanceMonitorRow,
	type MonitorConfiguration,
} from "@/repo/schema";
import { LedgerAccountBalanceMonitor, type MonitorScope } from "./LedgerAccountBalanceMonitor";
import {
	LedgerAccountBalanceMonitorPersistenceDecodingFailure,
	LedgerAccountBalanceMonitorPersistenceFailure,
} from "./LedgerAccountBalanceMonitorErrors";
import type { LedgerAccountBalanceMonitorListQuery } from "./LedgerAccountBalanceMonitorSchema";
const mapError = (cause: unknown) =>
	cause instanceof NotFoundError ||
	cause instanceof LedgerAccountBalanceMonitorPersistenceDecodingFailure
		? cause
		: new LedgerAccountBalanceMonitorPersistenceFailure(cause);
const accountWhere = (scope: MonitorScope) =>
	and(
		eq(accounts.id, scope.accountId),
		eq(accounts.ledgerId, scope.ledgerId),
		eq(accounts.organizationId, scope.organizationId)
	);
const monitorWhere = (scope: MonitorScope, id?: LedgerAccountBalanceMonitorID) =>
	and(
		eq(monitors.accountId, scope.accountId),
		eq(monitors.ledgerId, scope.ledgerId),
		eq(monitors.organizationId, scope.organizationId),
		isNull(monitors.deletedAt),
		id ? eq(monitors.id, id.toString()) : undefined
	);
const configuration = ({
	description,
	alertCondition,
	webhookUrl,
	webhookToken,
	metadata,
}: LedgerAccountBalanceMonitorRow): MonitorConfiguration => ({
	description,
	alertCondition,
	webhookUrl,
	webhookToken,
	metadata,
});
export class LedgerAccountBalanceMonitorRepoLive {
	constructor(private readonly db: EffectDrizzleDatabase) {}
	private requireAccount(scope: MonitorScope) {
		return this.db
			.select({ id: accounts.id })
			.from(accounts)
			.where(accountWhere(scope))
			.limit(1)
			.pipe(
				Effect.flatMap(rows =>
					rows.length ? Effect.void : Effect.fail(new NotFoundError("Account not found"))
				)
			);
	}
	listMonitors(scope: MonitorScope, query: LedgerAccountBalanceMonitorListQuery) {
		return this.requireAccount(scope).pipe(
			Effect.flatMap(() =>
				this.db
					.select()
					.from(monitors)
					.where(monitorWhere(scope))
					.orderBy(desc(monitors.created))
					.limit(query.limit)
					.offset(query.offset)
			),
			Effect.flatMap(rows => Effect.all(rows.map(row => LedgerAccountBalanceMonitor.fromRow(row)))),
			Effect.mapError(mapError)
		);
	}
	getMonitor(scope: MonitorScope, id: LedgerAccountBalanceMonitorID) {
		return this.requireAccount(scope).pipe(
			Effect.flatMap(() => this.db.select().from(monitors).where(monitorWhere(scope, id)).limit(1)),
			Effect.flatMap(rows =>
				rows[0]
					? LedgerAccountBalanceMonitor.fromRow(rows[0]).pipe(Effect.map(Option.some))
					: Effect.succeed(Option.none<LedgerAccountBalanceMonitor>())
			),
			Effect.mapError(mapError)
		);
	}
	createMonitor(record: LedgerAccountBalanceMonitor) {
		return this.db
			.transaction(tx =>
				Effect.gen(function* () {
					const [account] = yield* tx
						.select()
						.from(accounts)
						.where(accountWhere(record.row))
						.for("update");
					if (!account) return yield* Effect.fail(new NotFoundError("Account not found"));
					const [row] = yield* tx.insert(monitors).values(record.toCreateRow()).returning();
					yield* tx.insert(revisions).values({
						monitorId: row.id,
						accountId: row.accountId,
						version: row.lockVersion,
						startVersion: account.lockVersion,
						configuration: configuration(row),
					});
					yield* tx
						.update(accounts)
						.set({ balanceMonitorCount: sql`${accounts.balanceMonitorCount} + 1` })
						.where(accountWhere(record.row));
					return yield* LedgerAccountBalanceMonitor.fromRow(row);
				})
			)
			.pipe(Effect.mapError(mapError));
	}
	updateMonitor(
		scope: MonitorScope,
		id: LedgerAccountBalanceMonitorID,
		changes: Partial<MonitorConfiguration>,
		time: Date
	) {
		return this.db
			.transaction(tx =>
				Effect.gen(function* () {
					const [account] = yield* tx.select().from(accounts).where(accountWhere(scope)).for("update");
					if (!account) return yield* Effect.fail(new NotFoundError("Account not found"));
					const [current] = yield* tx.select().from(monitors).where(monitorWhere(scope, id));
					if (!current) return Option.none<LedgerAccountBalanceMonitor>();
					yield* tx
						.update(revisions)
						.set({ endVersion: account.lockVersion })
						.where(and(eq(revisions.monitorId, current.id), eq(revisions.version, current.lockVersion)));
					const [row] = yield* tx
						.update(monitors)
						.set({ ...changes, lockVersion: current.lockVersion + 1, updated: time })
						.where(monitorWhere(scope, id))
						.returning();
					yield* tx.insert(revisions).values({
						monitorId: row.id,
						accountId: row.accountId,
						version: row.lockVersion,
						startVersion: account.lockVersion,
						configuration: configuration(row),
					});
					// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
					return Option.some(yield* LedgerAccountBalanceMonitor.fromRow(row));
				})
			)
			.pipe(Effect.mapError(mapError));
	}
	deleteMonitor(scope: MonitorScope, id: LedgerAccountBalanceMonitorID, time: Date) {
		return this.db
			.transaction(tx =>
				Effect.gen(function* () {
					const [account] = yield* tx.select().from(accounts).where(accountWhere(scope)).for("update");
					if (!account) return yield* Effect.fail(new NotFoundError("Account not found"));
					const [current] = yield* tx.select().from(monitors).where(monitorWhere(scope, id));
					if (!current) return Option.none<void>();
					yield* tx
						.update(revisions)
						.set({ endVersion: account.lockVersion })
						.where(and(eq(revisions.monitorId, current.id), eq(revisions.version, current.lockVersion)));
					yield* tx
						.update(monitors)
						.set({ deletedAt: time, updated: time })
						.where(monitorWhere(scope, id));
					yield* tx
						.update(accounts)
						.set({ balanceMonitorCount: sql`${accounts.balanceMonitorCount} - 1` })
						.where(accountWhere(scope));
					// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
					return Option.some(undefined);
				})
			)
			.pipe(Effect.mapError(mapError));
	}
}
export type LedgerAccountBalanceMonitorRepo = Pick<
	LedgerAccountBalanceMonitorRepoLive,
	"listMonitors" | "getMonitor" | "createMonitor" | "updateMonitor" | "deleteMonitor"
>;
export const LedgerAccountBalanceMonitorRepoTag = Context.Service<LedgerAccountBalanceMonitorRepo>(
	"LedgerAccountBalanceMonitorRepo"
);
export const ledgerAccountBalanceMonitorRepoLayer = Layer.effect(
	LedgerAccountBalanceMonitorRepoTag,
	DatabaseTag.pipe(
		Effect.map(database => new LedgerAccountBalanceMonitorRepoLive(database.effectDb))
	)
);
