import { asc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type DrizzleDatabase, isPostgresUnavailable, postgresErrorCode } from "@/db";
import type { OrgID } from "../repo/entities/types";
import { OrganizationsTable } from "../repo/schema";
import { Organization } from "./domain/Organization";
import {
	OrganizationHasDependents,
	type OrganizationInfrastructureError,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "./domain/OrganizationErrors";

type OrganizationDeleteRepositoryError =
	| OrganizationInfrastructureError
	| OrganizationHasDependents;

type OrganizationListQuery = {
	offset: number;
	limit: number;
};

interface OrganizationRepo {
	listOrganizations(
		query: OrganizationListQuery
	): Effect.Effect<Organization[], OrganizationInfrastructureError>;
	getOrganization(
		id: OrgID
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError>;
	createOrganization(
		record: Organization
	): Effect.Effect<Organization, OrganizationInfrastructureError>;
	updateOrganization(
		record: Organization
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError>;
	deleteOrganization(
		id: OrgID
	): Effect.Effect<Option.Option<Organization>, OrganizationDeleteRepositoryError>;
}

const OrganizationRepoTag = Context.Service<OrganizationRepo>("OrganizationRepo");

const mapInfrastructureError = (cause: unknown): OrganizationInfrastructureError =>
	isPostgresUnavailable(cause)
		? new OrganizationRepositoryUnavailable(cause)
		: new OrganizationPersistenceFailure(cause);

const mapDeleteError = (cause: unknown, id: OrgID): OrganizationDeleteRepositoryError =>
	postgresErrorCode(cause) === "23503"
		? new OrganizationHasDependents(id.toString())
		: mapInfrastructureError(cause);
class OrganizationRepoLive implements OrganizationRepo {
	constructor(private readonly db: DrizzleDatabase) {}

	listOrganizations(
		query: OrganizationListQuery
	): Effect.Effect<Organization[], OrganizationInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select()
					.from(OrganizationsTable)
					.orderBy(asc(OrganizationsTable.id))
					.limit(query.limit)
					.offset(query.offset),
			catch: mapInfrastructureError,
		}).pipe(
			Effect.flatMap(rows => Effect.all(rows.map(row => Organization.fromRow(row)))),
			Effect.map(organizations => organizations.flatMap(organization => Option.toArray(organization)))
		);
	}

	getOrganization(
		id: OrgID
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select()
					.from(OrganizationsTable)
					.where(eq(OrganizationsTable.id, id.toString()))
					.limit(1),
			catch: mapInfrastructureError,
		}).pipe(Effect.flatMap(rows => Organization.fromRow(rows[0])));
	}

	createOrganization(
		record: Organization
	): Effect.Effect<Organization, OrganizationInfrastructureError> {
		return Effect.tryPromise({
			try: () => {
				const row = record.toRow();
				return this.db
					.insert(OrganizationsTable)
					.values({
						id: row.id,
						name: row.name,
						description: row.description,
					})
					.returning();
			},
			catch: mapInfrastructureError,
		}).pipe(
			Effect.flatMap(rows => Organization.fromRow(rows[0])),
			Effect.flatMap(
				Option.match({
					onNone: () =>
						Effect.fail(new OrganizationPersistenceFailure(new Error("INSERT returned no row"))),
					onSome: Effect.succeed,
				})
			)
		);
	}

	updateOrganization(
		record: Organization
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError> {
		return Effect.tryPromise({
			try: () => {
				const row = record.toRow();
				return this.db
					.update(OrganizationsTable)
					.set({ name: row.name, description: row.description, updated: row.updated })
					.where(eq(OrganizationsTable.id, row.id))
					.returning();
			},
			catch: mapInfrastructureError,
		}).pipe(Effect.flatMap(rows => Organization.fromRow(rows[0])));
	}

	deleteOrganization(
		id: OrgID
	): Effect.Effect<Option.Option<Organization>, OrganizationDeleteRepositoryError> {
		return Effect.tryPromise({
			try: () =>
				this.db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id.toString())).returning(),
			catch: cause => mapDeleteError(cause, id),
		}).pipe(Effect.flatMap(rows => Organization.fromRow(rows[0])));
	}
}

const organizationRepoLayer = Layer.effect(
	OrganizationRepoTag,
	DatabaseTag.pipe(Effect.map(database => new OrganizationRepoLive(database.db)))
);

export type { OrganizationDeleteRepositoryError, OrganizationListQuery };
export type { OrganizationInfrastructureError } from "./domain/OrganizationErrors";
export { type OrganizationRepo, OrganizationRepoLive, OrganizationRepoTag, organizationRepoLayer };
