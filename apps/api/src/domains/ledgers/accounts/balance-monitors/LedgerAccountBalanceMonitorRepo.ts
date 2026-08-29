import { desc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";

import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import type { LedgerAccountBalanceMonitorID } from "@/repo/entities/types";
import { LedgerAccountBalanceMonitorsTable } from "@/repo/schema";

import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import {
	type LedgerAccountBalanceMonitorInfrastructureError,
	LedgerAccountBalanceMonitorPersistenceDecodingFailure,
	LedgerAccountBalanceMonitorPersistenceFailure,
} from "./LedgerAccountBalanceMonitorErrors";

type LedgerAccountBalanceMonitorListQuery = Readonly<{
	offset: number;
	limit: number;
}>;

interface LedgerAccountBalanceMonitorRepo {
	listMonitors(
		query: LedgerAccountBalanceMonitorListQuery
	): Effect.Effect<LedgerAccountBalanceMonitor[], LedgerAccountBalanceMonitorInfrastructureError>;
	getMonitor(
		id: LedgerAccountBalanceMonitorID
	): Effect.Effect<
		Option.Option<LedgerAccountBalanceMonitor>,
		LedgerAccountBalanceMonitorInfrastructureError
	>;
	createMonitor(
		record: LedgerAccountBalanceMonitor
	): Effect.Effect<LedgerAccountBalanceMonitor, LedgerAccountBalanceMonitorInfrastructureError>;
	updateMonitor(
		id: LedgerAccountBalanceMonitorID,
		record: LedgerAccountBalanceMonitor
	): Effect.Effect<
		Option.Option<LedgerAccountBalanceMonitor>,
		LedgerAccountBalanceMonitorInfrastructureError
	>;
	deleteMonitor(
		id: LedgerAccountBalanceMonitorID
	): Effect.Effect<Option.Option<void>, LedgerAccountBalanceMonitorInfrastructureError>;
}

const LedgerAccountBalanceMonitorRepoTag = Context.Service<LedgerAccountBalanceMonitorRepo>(
	"LedgerAccountBalanceMonitorRepo"
);

const mapInfrastructureError = (cause: unknown): LedgerAccountBalanceMonitorInfrastructureError =>
	cause instanceof LedgerAccountBalanceMonitorPersistenceDecodingFailure
		? cause
		: new LedgerAccountBalanceMonitorPersistenceFailure(cause);

class LedgerAccountBalanceMonitorRepoLive implements LedgerAccountBalanceMonitorRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}

	listMonitors(
		query: LedgerAccountBalanceMonitorListQuery
	): Effect.Effect<LedgerAccountBalanceMonitor[], LedgerAccountBalanceMonitorInfrastructureError> {
		return this.db
			.select()
			.from(LedgerAccountBalanceMonitorsTable)
			.orderBy(desc(LedgerAccountBalanceMonitorsTable.created))
			.limit(query.limit)
			.offset(query.offset)
			.pipe(
				Effect.flatMap(rows => Effect.all(rows.map(row => LedgerAccountBalanceMonitor.fromRow(row)))),
				Effect.map(monitors => monitors.flatMap(value => Option.toArray(value))),
				Effect.mapError(mapInfrastructureError)
			);
	}

	getMonitor(
		id: LedgerAccountBalanceMonitorID
	): Effect.Effect<
		Option.Option<LedgerAccountBalanceMonitor>,
		LedgerAccountBalanceMonitorInfrastructureError
	> {
		return this.db
			.select()
			.from(LedgerAccountBalanceMonitorsTable)
			.where(eq(LedgerAccountBalanceMonitorsTable.id, id.toString()))
			.limit(1)
			.pipe(
				Effect.flatMap(rows => LedgerAccountBalanceMonitor.fromRow(rows[0])),
				Effect.mapError(mapInfrastructureError)
			);
	}

	createMonitor(
		record: LedgerAccountBalanceMonitor
	): Effect.Effect<LedgerAccountBalanceMonitor, LedgerAccountBalanceMonitorInfrastructureError> {
		return this.db
			.insert(LedgerAccountBalanceMonitorsTable)
			.values(record.toCreateRow())
			.returning()
			.pipe(
				Effect.flatMap(rows => LedgerAccountBalanceMonitor.fromRow(rows[0])),
				Effect.flatMap(
					Option.match({
						onNone: () =>
							Effect.fail(
								new LedgerAccountBalanceMonitorPersistenceFailure(new Error("INSERT returned no row"))
							),
						onSome: Effect.succeed,
					})
				),
				Effect.mapError(mapInfrastructureError)
			);
	}

	updateMonitor(
		id: LedgerAccountBalanceMonitorID,
		record: LedgerAccountBalanceMonitor
	): Effect.Effect<
		Option.Option<LedgerAccountBalanceMonitor>,
		LedgerAccountBalanceMonitorInfrastructureError
	> {
		return this.db
			.update(LedgerAccountBalanceMonitorsTable)
			.set(record.toUpdateRow())
			.where(eq(LedgerAccountBalanceMonitorsTable.id, id.toString()))
			.returning()
			.pipe(
				Effect.flatMap(rows => LedgerAccountBalanceMonitor.fromRow(rows[0])),
				Effect.mapError(mapInfrastructureError)
			);
	}

	deleteMonitor(
		id: LedgerAccountBalanceMonitorID
	): Effect.Effect<Option.Option<void>, LedgerAccountBalanceMonitorInfrastructureError> {
		return this.db
			.delete(LedgerAccountBalanceMonitorsTable)
			.where(eq(LedgerAccountBalanceMonitorsTable.id, id.toString()))
			.returning({ id: LedgerAccountBalanceMonitorsTable.id })
			.pipe(
				// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives the presence marker.
				Effect.map(rows => (rows.length === 0 ? Option.none() : Option.some(undefined))),
				Effect.mapError(mapInfrastructureError)
			);
	}
}

const ledgerAccountBalanceMonitorRepoLayer = Layer.effect(
	LedgerAccountBalanceMonitorRepoTag,
	DatabaseTag.pipe(
		Effect.map(database => new LedgerAccountBalanceMonitorRepoLive(database.effectDb))
	)
);

export type { LedgerAccountBalanceMonitorListQuery, LedgerAccountBalanceMonitorRepo };
export {
	LedgerAccountBalanceMonitorRepoLive,
	LedgerAccountBalanceMonitorRepoTag,
	ledgerAccountBalanceMonitorRepoLayer,
};
