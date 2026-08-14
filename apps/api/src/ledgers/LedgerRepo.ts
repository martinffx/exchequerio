import { and, asc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type DrizzleDatabase, isPostgresUnavailable, postgresErrorCode } from "@/db";
import { parseId } from "@/lib/utils";
import { OrganizationNotFound } from "@/organizations";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import { LedgersTable } from "@/repo/schema";
import { Ledger, type LedgerMetadata, type LedgerWrite } from "./domain/Ledger";
import {
	LedgerHasDependents,
	type LedgerInfrastructureError as LedgerInfrastructureErrorType,
	LedgerPersistenceDecodingFailure,
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
	create(record: LedgerWrite): Effect.Effect<Ledger, LedgerCreateRepositoryError>;
	update(record: LedgerWrite): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError>;
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

type LedgerRow = {
	readonly id: string;
	readonly organizationId: string;
	readonly name: string;
	readonly description: string | null;
	readonly metadata: string | null;
	readonly created: Date;
	readonly updated: Date;
};

const decodeDate = (value: Date): Date => {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
		throw new Error("Invalid Ledger timestamp");
	}
	return value;
};

const decodeMetadata = (value: string | null): LedgerMetadata | undefined => {
	if (value === null) return undefined;
	const decoded: unknown = JSON.parse(value);
	if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
		throw new Error("Ledger metadata must be an object");
	}
	if (!Object.values(decoded).every(item => typeof item === "string")) {
		throw new Error("Ledger metadata values must be strings");
	}
	return decoded as Record<string, string>;
};

const decodeLedger = (
	row: LedgerRow | undefined
): Effect.Effect<Option.Option<Ledger>, LedgerPersistenceDecodingFailure> => {
	if (row === undefined) return Effect.succeed(Option.none());

	return Effect.gen(function* () {
		const id = yield* parseId<"lgr", LedgerID>("lgr", row.id);
		const organizationId = yield* parseId<"org", OrgID>("org", row.organizationId);
		const decoded = yield* Effect.try({
			try: () => ({
				created: decodeDate(row.created),
				updated: decodeDate(row.updated),
				metadata: decodeMetadata(row.metadata),
			}),
			catch: cause => cause,
		});
		return Option.some(
			// eslint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives a value.
			new Ledger({
				id,
				organizationId,
				name: row.name,
				description: row.description ?? undefined,
				metadata: decoded.metadata,
				created: decoded.created,
				updated: decoded.updated,
			})
		);
	}).pipe(Effect.mapError(cause => new LedgerPersistenceDecodingFailure(cause)));
};

const mapInfrastructureError = (
	cause: unknown,
	context: { readonly organizationId?: string; readonly ledgerId?: string } = {}
): LedgerInfrastructureError =>
	isPostgresUnavailable(cause)
		? new LedgerRepositoryUnavailable(cause, context)
		: new LedgerPersistenceFailure(cause, context);

const errorContext = (record: LedgerWrite) => ({
	organizationId: record.organizationId.toString(),
	ledgerId: record.id.toString(),
});

const mapCreateError = (cause: unknown, record: LedgerWrite): LedgerCreateRepositoryError => {
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
	decodeLedger(row).pipe(
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
			Effect.flatMap(rows => Effect.all(rows.map(row => decodeLedger(row)))),
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
		}).pipe(Effect.flatMap(rows => decodeLedger(rows[0])));
	}

	create(record: LedgerWrite): Effect.Effect<Ledger, LedgerCreateRepositoryError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.insert(LedgersTable)
					.values({
						id: record.id.toString(),
						organizationId: record.organizationId.toString(),
						name: record.name,
						description: record.description,
						metadata: record.metadata === undefined ? undefined : JSON.stringify(record.metadata),
					})
					.returning(publicColumns),
			catch: cause => mapCreateError(cause, record),
		}).pipe(Effect.flatMap(rows => requireDecoded(rows[0], errorContext(record))));
	}

	update(record: LedgerWrite): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.update(LedgersTable)
					.set({
						name: record.name,
						// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
						description: record.description ?? null,
						// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
						metadata: record.metadata === undefined ? null : JSON.stringify(record.metadata),
						updated: sql`CURRENT_TIMESTAMP`,
					})
					.where(
						and(
							eq(LedgersTable.id, record.id.toString()),
							eq(LedgersTable.organizationId, record.organizationId.toString())
						)
					)
					.returning(publicColumns),
			catch: cause => mapInfrastructureError(cause, errorContext(record)),
		}).pipe(Effect.flatMap(rows => decodeLedger(rows[0])));
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
