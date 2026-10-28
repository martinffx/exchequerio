import { TypeID } from "typeid-js";
import { encodeUuid } from "@/lib/utils";
import { and, desc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import { NotFoundError } from "@/lib/errors";
import type { LedgerAccountBalanceMonitorID } from "@/lib/ids";
import {
	LedgerAccountBalanceMonitorsTable as monitors,
	LedgerAccountsTable as accounts,
	type MonitorConfiguration,
} from "@/db/schema";
import {
	LedgerAccountBalanceMonitor,
	type LedgerAccountBalanceMonitorRecord,
	type MonitorScope,
} from "./LedgerAccountBalanceMonitor";
import {
	LedgerAccountBalanceMonitorPersistenceDecodingFailure,
	LedgerAccountBalanceMonitorPersistenceFailure,
} from "./LedgerAccountBalanceMonitorErrors";
import type { LedgerAccountBalanceMonitorListQuery } from "./LedgerAccountBalanceMonitorSchema";
const mapError = (cause: unknown) =>
	cause instanceof NotFoundError ||
	cause instanceof LedgerAccountBalanceMonitorPersistenceDecodingFailure
		? cause
		: new LedgerAccountBalanceMonitorPersistenceFailure();
const toScopeRow = (scope: MonitorScope): MonitorScope => ({
	organizationId: encodeUuid(TypeID.fromString(scope.organizationId)),
	ledgerId: encodeUuid(TypeID.fromString(scope.ledgerId)),
	accountId: encodeUuid(TypeID.fromString(scope.accountId)),
});
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
		id ? eq(monitors.id, encodeUuid(id)) : undefined
	);
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
		return Effect.suspend(() => {
			const scopeRow = toScopeRow(scope);
			return this.requireAccount(scopeRow).pipe(
				Effect.flatMap(() =>
					this.db
						.select()
						.from(monitors)
						.where(monitorWhere(scopeRow))
						.orderBy(desc(monitors.created))
						.limit(query.limit)
						.offset(query.offset)
				),
				Effect.flatMap(rows => Effect.all(rows.map(row => LedgerAccountBalanceMonitor.fromRow(row)))),
				Effect.mapError(mapError)
			);
		}).pipe(Effect.withSpan("LedgerAccountBalanceMonitorRepo.listMonitors"));
	}
	getMonitor(scope: MonitorScope, id: LedgerAccountBalanceMonitorID) {
		return Effect.suspend(() => {
			const scopeRow = toScopeRow(scope);
			return this.requireAccount(scopeRow).pipe(
				Effect.flatMap(() =>
					this.db.select().from(monitors).where(monitorWhere(scopeRow, id)).limit(1)
				),
				Effect.flatMap(rows =>
					rows[0]
						? LedgerAccountBalanceMonitor.fromRow(rows[0]).pipe(Effect.map(Option.some))
						: Effect.succeed(Option.none<LedgerAccountBalanceMonitorRecord>())
				),
				Effect.mapError(mapError)
			);
		}).pipe(Effect.withSpan("LedgerAccountBalanceMonitorRepo.getMonitor"));
	}
	createMonitor(record: LedgerAccountBalanceMonitorRecord) {
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
					return yield* LedgerAccountBalanceMonitor.fromRow(row);
				})
			)
			.pipe(
				Effect.mapError(mapError),
				Effect.withSpan("LedgerAccountBalanceMonitorRepo.createMonitor")
			);
	}
	updateMonitor(
		scope: MonitorScope,
		id: LedgerAccountBalanceMonitorID,
		changes: Partial<MonitorConfiguration>,
		time: Date
	) {
		return Effect.suspend(() => {
			const scopeRow = toScopeRow(scope);
			return this.db
				.transaction(tx =>
					Effect.gen(function* () {
						const [account] = yield* tx
							.select()
							.from(accounts)
							.where(accountWhere(scopeRow))
							.for("update");
						if (!account) return yield* Effect.fail(new NotFoundError("Account not found"));
						const [current] = yield* tx.select().from(monitors).where(monitorWhere(scopeRow, id));
						if (!current) return Option.none<LedgerAccountBalanceMonitorRecord>();
						const [row] = yield* tx
							.update(monitors)
							.set({ ...changes, lockVersion: current.lockVersion + 1, updated: time })
							.where(monitorWhere(scopeRow, id))
							.returning();
						// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
						return Option.some(yield* LedgerAccountBalanceMonitor.fromRow(row));
					})
				)
				.pipe(Effect.mapError(mapError));
		}).pipe(Effect.withSpan("LedgerAccountBalanceMonitorRepo.updateMonitor"));
	}
	deleteMonitor(scope: MonitorScope, id: LedgerAccountBalanceMonitorID) {
		return Effect.suspend(() => {
			const scopeRow = toScopeRow(scope);
			return this.db
				.transaction(tx =>
					Effect.gen(function* () {
						const [account] = yield* tx
							.select()
							.from(accounts)
							.where(accountWhere(scopeRow))
							.for("update");
						if (!account) return yield* Effect.fail(new NotFoundError("Account not found"));
						const [current] = yield* tx.select().from(monitors).where(monitorWhere(scopeRow, id));
						if (!current) return Option.none<void>();
						yield* tx.delete(monitors).where(monitorWhere(scopeRow, id));
						// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
						return Option.some(undefined);
					})
				)
				.pipe(Effect.mapError(mapError));
		}).pipe(Effect.withSpan("LedgerAccountBalanceMonitorRepo.deleteMonitor"));
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
