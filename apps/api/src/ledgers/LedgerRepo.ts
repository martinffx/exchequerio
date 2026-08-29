import { and, asc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type DrizzleDatabase } from "@/db";
import { OrganizationNotFound } from "@/organizations";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import { LedgersTable } from "@/repo/schema";
import { Ledger } from "./domain/Ledger";
import {
	LedgerHasDependents,
	type LedgerInfrastructureError as LedgerInfrastructureErrorType,
	mapLedgerCreateError,
	mapLedgerDeleteError,
	mapLedgerInfrastructureError,
	requireCreatedLedger,
} from "./LedgerErrors";

type LedgerInfrastructureError = LedgerInfrastructureErrorType;

type LedgerListQuery = {
	readonly offset: number;
	readonly limit: number;
};

interface LedgerRepo {
	listLedgers(
		organizationId: OrgID,
		query: LedgerListQuery
	): Effect.Effect<Ledger[], LedgerInfrastructureError>;
	getLedger(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError>;
	createLedger(record: Ledger): Effect.Effect<Ledger, LedgerCreateRepositoryError>;
	updateLedger(record: Ledger): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError>;
	deleteLedger(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<Ledger>, LedgerDeleteRepositoryError>;
}

type LedgerCreateRepositoryError = LedgerInfrastructureError | OrganizationNotFound;
type LedgerDeleteRepositoryError = LedgerInfrastructureError | LedgerHasDependents;

const LedgerRepoTag = Context.Service<LedgerRepo>("LedgerRepo");

const publicColumns = {
	id: LedgersTable.id,
	organizationId: LedgersTable.organizationId,
	name: LedgersTable.name,
	description: LedgersTable.description,
	metadata: LedgersTable.metadata,
	created: LedgersTable.created,
	updated: LedgersTable.updated,
};

class LedgerRepoLive implements LedgerRepo {
	constructor(private readonly db: DrizzleDatabase) {}

	listLedgers(
		organizationId: OrgID,
		{ limit, offset }: LedgerListQuery
	): Effect.Effect<Ledger[], LedgerInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(publicColumns)
					.from(LedgersTable)
					.where(eq(LedgersTable.organizationId, organizationId.toString()))
					.orderBy(asc(LedgersTable.id))
					.limit(limit)
					.offset(offset),
			catch: mapLedgerInfrastructureError,
		}).pipe(
			Effect.flatMap(rows => Effect.all(rows.map(row => Ledger.fromRow(row)))),
			Effect.map(ledgers => ledgers.flatMap(ledger => Option.toArray(ledger)))
		);
	}

	getLedger(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(publicColumns)
					.from(LedgersTable)
					.where(
						and(
							eq(LedgersTable.id, ledgerId.toString()),
							eq(LedgersTable.organizationId, organizationId.toString())
						)
					)
					.limit(1),
			catch: mapLedgerInfrastructureError,
		}).pipe(Effect.flatMap(rows => Ledger.fromRow(rows[0])));
	}

	createLedger(record: Ledger): Effect.Effect<Ledger, LedgerCreateRepositoryError> {
		return Effect.tryPromise({
			try: () => this.db.insert(LedgersTable).values(record.toCreateRow()).returning(publicColumns),
			catch: mapLedgerCreateError,
		}).pipe(
			Effect.flatMap(rows => Ledger.fromRow(rows[0])),
			Effect.flatMap(requireCreatedLedger)
		);
	}

	updateLedger(record: Ledger): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.update(LedgersTable)
					.set(record.toUpdateRow())
					.where(
						and(
							eq(LedgersTable.id, record.id.toString()),
							eq(LedgersTable.organizationId, record.organizationId.toString())
						)
					)
					.returning(publicColumns),
			catch: mapLedgerInfrastructureError,
		}).pipe(Effect.flatMap(rows => Ledger.fromRow(rows[0])));
	}

	deleteLedger(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<Ledger>, LedgerDeleteRepositoryError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.delete(LedgersTable)
					.where(
						and(
							eq(LedgersTable.id, ledgerId.toString()),
							eq(LedgersTable.organizationId, organizationId.toString())
						)
					)
					.returning(publicColumns),
			catch: mapLedgerDeleteError,
		}).pipe(Effect.flatMap(rows => Ledger.fromRow(rows[0])));
	}
}

const ledgerRepoLayer = Layer.effect(
	LedgerRepoTag,
	DatabaseTag.pipe(Effect.map(database => new LedgerRepoLive(database.db)))
);

export type {
	LedgerCreateRepositoryError,
	LedgerDeleteRepositoryError,
	LedgerListQuery,
	LedgerRepo,
};
export type { LedgerInfrastructureError } from "./LedgerErrors";
export { LedgerRepoLive, LedgerRepoTag, ledgerRepoLayer };
