import { and, asc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type DrizzleDatabase, isPostgresUnavailable, postgresErrorCode } from "@/db";
import { OrganizationNotFound } from "@/organizations";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import { type LedgerRow, LedgersTable } from "@/repo/schema";
import { Ledger } from "./domain/Ledger";
import {
	LedgerHasDependents,
	type LedgerInfrastructureError as LedgerInfrastructureErrorType,
	LedgerPersistenceFailure,
	LedgerRepositoryUnavailable,
} from "./LedgerErrors";

type LedgerInfrastructureError = LedgerInfrastructureErrorType;

type LedgerListQuery = {
	readonly offset: number;
	readonly limit: number;
};

interface LedgerRepo {
	list(
		organizationId: OrgID,
		query: LedgerListQuery
	): Effect.Effect<Ledger[], LedgerInfrastructureError>;
	get(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError>;
	create(record: Ledger): Effect.Effect<Ledger, LedgerCreateRepositoryError>;
	update(record: Ledger): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError>;
	delete(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<void>, LedgerDeleteRepositoryError>;
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

const mapInfrastructureError = (
	cause: unknown,
	context: { readonly organizationId?: string; readonly ledgerId?: string } = {}
): LedgerInfrastructureError =>
	isPostgresUnavailable(cause)
		? new LedgerRepositoryUnavailable(cause, context)
		: new LedgerPersistenceFailure(cause, context);

const errorContext = (record: Ledger) => ({
	organizationId: record.organizationId.toString(),
	ledgerId: record.id.toString(),
});

const mapCreateError = (cause: unknown, record: Ledger): LedgerCreateRepositoryError => {
	const code = postgresErrorCode(cause);
	if (code === "23503") return new OrganizationNotFound(record.organizationId.toString());
	if (code === "23505") return new LedgerPersistenceFailure(cause, errorContext(record));
	return mapInfrastructureError(cause, errorContext(record));
};

const mapDeleteError = (
	cause: unknown,
	organizationId: OrgID,
	ledgerId: LedgerID
): LedgerDeleteRepositoryError =>
	postgresErrorCode(cause) === "23503"
		? new LedgerHasDependents(organizationId.toString(), ledgerId.toString())
		: mapInfrastructureError(cause, {
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
			});

const requireDecoded = (
	row: LedgerRow | undefined,
	context: { readonly organizationId?: string; readonly ledgerId?: string }
): Effect.Effect<Ledger, LedgerInfrastructureError> =>
	Ledger.fromRow(row).pipe(
		Effect.flatMap(
			Option.match({
				onNone: () =>
					Effect.fail(
						new LedgerPersistenceFailure(new Error("Database write returned no row"), context)
					),
				onSome: value => Effect.succeed(value),
			})
		)
	);

class LedgerRepoLive implements LedgerRepo {
	constructor(private readonly db: DrizzleDatabase) {}

	list(
		organizationId: OrgID,
		query: LedgerListQuery
	): Effect.Effect<Ledger[], LedgerInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(publicColumns)
					.from(LedgersTable)
					.where(eq(LedgersTable.organizationId, organizationId.toString()))
					.orderBy(asc(LedgersTable.id))
					.limit(query.limit)
					.offset(query.offset),
			catch: mapInfrastructureError,
		}).pipe(
			Effect.flatMap(rows => Effect.all(rows.map(row => Ledger.fromRow(row)))),
			Effect.map(ledgers => ledgers.flatMap(ledger => Option.toArray(ledger)))
		);
	}

	get(
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
			catch: mapInfrastructureError,
		}).pipe(Effect.flatMap(rows => Ledger.fromRow(rows[0])));
	}

	create(record: Ledger): Effect.Effect<Ledger, LedgerCreateRepositoryError> {
		return Effect.tryPromise({
			try: () => {
				const row = record.toRow();
				return this.db
					.insert(LedgersTable)
					.values({
						id: row.id,
						organizationId: row.organizationId,
						name: row.name,
						description: row.description,
						metadata: row.metadata,
					})
					.returning(publicColumns);
			},
			catch: cause => mapCreateError(cause, record),
		}).pipe(Effect.flatMap(rows => requireDecoded(rows[0], errorContext(record))));
	}

	update(record: Ledger): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError> {
		return Effect.tryPromise({
			try: () => {
				const row = record.toRow();
				return this.db
					.update(LedgersTable)
					.set({
						name: row.name,
						description: row.description,
						metadata: row.metadata,
						updated: sql`CURRENT_TIMESTAMP`,
					})
					.where(and(eq(LedgersTable.id, row.id), eq(LedgersTable.organizationId, row.organizationId)))
					.returning(publicColumns);
			},
			catch: cause => mapInfrastructureError(cause, errorContext(record)),
		}).pipe(Effect.flatMap(rows => Ledger.fromRow(rows[0])));
	}

	delete(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<void>, LedgerDeleteRepositoryError> {
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
					.returning({ id: LedgersTable.id }),
			catch: cause => mapDeleteError(cause, organizationId, ledgerId),
		}).pipe(Effect.map(rows => (rows[0] === undefined ? Option.none() : Option.void)));
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
