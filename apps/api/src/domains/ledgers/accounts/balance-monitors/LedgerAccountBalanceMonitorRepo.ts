import { encodeUuid } from "@/lib/utils";
import { desc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";

import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import type { LedgerAccountBalanceMonitorID } from "@/repo/entities/types";
import {
	type LedgerAccountBalanceMonitorRow,
	LedgerAccountBalanceMonitorsTable,
} from "@/repo/schema";

import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import type { LedgerAccountBalanceMonitorListQuery } from "./LedgerAccountBalanceMonitorSchema";
import {
	type LedgerAccountBalanceMonitorInfrastructureError,
	LedgerAccountBalanceMonitorPersistenceDecodingFailure,
	LedgerAccountBalanceMonitorPersistenceFailure,
} from "./LedgerAccountBalanceMonitorErrors";

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
	cause instanceof LedgerAccountBalanceMonitorPersistenceDecodingFailure ||
	cause instanceof LedgerAccountBalanceMonitorPersistenceFailure
		? cause
		: new LedgerAccountBalanceMonitorPersistenceFailure(cause);

const decodeOptionalRow = (row: LedgerAccountBalanceMonitorRow | undefined) =>
	row === undefined
		? Effect.succeed(Option.none<LedgerAccountBalanceMonitor>())
		: // oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives the decoded monitor.
			LedgerAccountBalanceMonitor.fromRow(row).pipe(Effect.map(monitor => Option.some(monitor)));

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
			.where(eq(LedgerAccountBalanceMonitorsTable.id, encodeUuid(id)))
			.limit(1)
			.pipe(
				Effect.flatMap(rows => decodeOptionalRow(rows[0])),
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
				Effect.flatMap(rows =>
					rows[0] === undefined
						? Effect.fail(
								new LedgerAccountBalanceMonitorPersistenceFailure(new Error("INSERT returned no row"))
							)
						: LedgerAccountBalanceMonitor.fromRow(rows[0])
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
			.where(eq(LedgerAccountBalanceMonitorsTable.id, encodeUuid(id)))
			.returning()
			.pipe(
				Effect.flatMap(rows => decodeOptionalRow(rows[0])),
				Effect.mapError(mapInfrastructureError)
			);
	}

	deleteMonitor(
		id: LedgerAccountBalanceMonitorID
	): Effect.Effect<Option.Option<void>, LedgerAccountBalanceMonitorInfrastructureError> {
		return this.db
			.delete(LedgerAccountBalanceMonitorsTable)
			.where(eq(LedgerAccountBalanceMonitorsTable.id, encodeUuid(id)))
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

export type { LedgerAccountBalanceMonitorRepo };
export {
	LedgerAccountBalanceMonitorRepoLive,
	LedgerAccountBalanceMonitorRepoTag,
	ledgerAccountBalanceMonitorRepoLayer,
};
