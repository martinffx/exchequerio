import { asc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";
import { DatabaseTag, type DrizzleDatabase } from "../database/Database";
import { isPostgresUnavailable, postgresErrorCode } from "../database/PostgresErrors";
import { OrganizationsTable } from "../repo/schema";
import type { OrganizationListScope } from "./domain/OrganizationAccess";
import { parseOrganizationId, type OrganizationId } from "./domain/OrganizationId";
import {
	createOrganization,
	type Organization,
	type CreateOrganizationInput,
	type UpdateOrganizationInput,
} from "./domain/Organization";
import {
	OrganizationHasDependents,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "./domain/OrganizationErrors";

type OrganizationInfrastructureError =
	| OrganizationPersistenceDecodingFailure
	| OrganizationPersistenceFailure
	| OrganizationRepositoryUnavailable;

type OrganizationDeleteRepositoryError =
	| OrganizationInfrastructureError
	| OrganizationHasDependents;

interface OrganizationListQuery {
	readonly scope: OrganizationListScope;
	readonly offset: number;
	readonly limit: number;
}

interface OrganizationCreateRecord extends CreateOrganizationInput {
	readonly id: OrganizationId;
}

type OrganizationRowDecodeResult =
	| { readonly _tag: "Success"; readonly value: Organization }
	| { readonly _tag: "Failure"; readonly error: OrganizationPersistenceDecodingFailure };

const decodingFailure = (cause: unknown): OrganizationRowDecodeResult => ({
	_tag: "Failure",
	error: new OrganizationPersistenceDecodingFailure(cause),
});

const decodeOrganizationRow = (row: unknown): OrganizationRowDecodeResult => {
	if (typeof row !== "object" || row === null) return decodingFailure(row);
	const value = row as Record<string, unknown>;
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		(value.description !== null && typeof value.description !== "string") ||
		!(value.created instanceof Date) ||
		!(value.updated instanceof Date)
	) {
		return decodingFailure(row);
	}

	const id = parseOrganizationId(value.id);
	const created = DateTime.fromJSDate(value.created, { zone: "utc" });
	const updated = DateTime.fromJSDate(value.updated, { zone: "utc" });
	if (id._tag === "Failure" || !created.isValid || !updated.isValid) return decodingFailure(row);

	return {
		_tag: "Success",
		value: createOrganization({
			id: id.value,
			name: value.name,
			...(value.description === null ? {} : { description: value.description }),
			created,
			updated,
		}),
	};
};

abstract class OrganizationRepo {
	abstract list(
		query: OrganizationListQuery
	): Effect.Effect<readonly Organization[], OrganizationInfrastructureError>;
	abstract get(
		id: OrganizationId
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError>;
	abstract create(
		record: OrganizationCreateRecord
	): Effect.Effect<Organization, OrganizationInfrastructureError>;
	abstract update(
		id: OrganizationId,
		input: UpdateOrganizationInput
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError>;
	abstract delete(
		id: OrganizationId
	): Effect.Effect<Option.Option<Organization>, OrganizationDeleteRepositoryError>;
}

const OrganizationRepoTag = Context.Service<OrganizationRepo>("OrganizationRepo");

const mapInfrastructureError = (cause: unknown): OrganizationInfrastructureError =>
	isPostgresUnavailable(cause)
		? new OrganizationRepositoryUnavailable(cause)
		: new OrganizationPersistenceFailure(cause);

const mapDeleteError = (cause: unknown, id: OrganizationId): OrganizationDeleteRepositoryError =>
	postgresErrorCode(cause) === "23503"
		? new OrganizationHasDependents(id)
		: mapInfrastructureError(cause);

const decodeRow = (row: unknown): Effect.Effect<Organization, OrganizationInfrastructureError> => {
	const decoded = decodeOrganizationRow(row);
	return decoded._tag === "Success" ? Effect.succeed(decoded.value) : Effect.fail(decoded.error);
};

const decodeOptionalRow = (
	rows: readonly unknown[]
): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError> =>
	rows[0] === undefined
		? Effect.succeed(Option.none())
		: decodeRow(rows[0]).pipe(Effect.map(Option.some));

class OrganizationRepoLive extends OrganizationRepo {
	constructor(private readonly db: DrizzleDatabase) {
		super();
	}

	list(query: OrganizationListQuery) {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select()
					.from(OrganizationsTable)
					.where(
						query.scope._tag === "Organization"
							? eq(OrganizationsTable.id, query.scope.organizationId)
							: undefined
					)
					.orderBy(asc(OrganizationsTable.id))
					.limit(query.limit)
					.offset(query.offset),
			catch: mapInfrastructureError,
		}).pipe(Effect.flatMap(rows => Effect.all(rows.map(row => decodeRow(row)))));
	}

	get(id: OrganizationId) {
		return Effect.tryPromise({
			try: () =>
				this.db.select().from(OrganizationsTable).where(eq(OrganizationsTable.id, id)).limit(1),
			catch: mapInfrastructureError,
		}).pipe(Effect.flatMap(decodeOptionalRow));
	}

	create(record: OrganizationCreateRecord) {
		return Effect.tryPromise({
			try: () =>
				this.db
					.insert(OrganizationsTable)
					.values({
						id: record.id,
						name: record.name,
						description: record.description,
					})
					.returning(),
			catch: mapInfrastructureError,
		}).pipe(
			Effect.flatMap(rows =>
				rows[0] === undefined
					? Effect.fail(new OrganizationPersistenceFailure(new Error("INSERT returned no row")))
					: decodeRow(rows[0])
			)
		);
	}

	update(id: OrganizationId, input: UpdateOrganizationInput) {
		const values = {
			name: input.name,
			updated: sql`now()`,
			...(input.description._tag === "Replace" ? { description: input.description.value } : {}),
		};
		return Effect.tryPromise({
			try: () =>
				this.db.update(OrganizationsTable).set(values).where(eq(OrganizationsTable.id, id)).returning(),
			catch: mapInfrastructureError,
		}).pipe(Effect.flatMap(decodeOptionalRow));
	}

	delete(id: OrganizationId) {
		return Effect.tryPromise({
			try: () => this.db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id)).returning(),
			catch: cause => mapDeleteError(cause, id),
		}).pipe(Effect.flatMap(decodeOptionalRow));
	}
}

const organizationRepoLayer = Layer.effect(
	OrganizationRepoTag,
	DatabaseTag.pipe(Effect.map(database => new OrganizationRepoLive(database.db)))
);

export type {
	OrganizationCreateRecord,
	OrganizationDeleteRepositoryError,
	OrganizationInfrastructureError,
	OrganizationListQuery,
};
export {
	decodeOrganizationRow,
	OrganizationRepo,
	OrganizationRepoLive,
	OrganizationRepoTag,
	organizationRepoLayer,
};
