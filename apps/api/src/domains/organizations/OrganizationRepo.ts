import { encodeUuid } from "@/lib/utils";
import { asc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type DrizzleDatabase, isPostgresUnavailable, postgresErrorCode } from "@/db";
import type { OrgID } from "@/lib/ids";
import { OrganizationsTable } from "../../db/schema";
import { Organization } from "./Organization";
import {
	OrganizationHasDependents,
	type OrganizationInfrastructureError,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "./OrganizationErrors";

type OrganizationDeleteRepositoryError =
	| OrganizationInfrastructureError
	| OrganizationHasDependents;

type OrganizationListQuery = {
	offset: number;
	limit: number;
};

/**
 * Persists Organizations and reports expected failures through Effect error channels.
 */
interface OrganizationRepo {
	/**
	 * Lists Organizations with pagination.
	 *
	 * @param query - Pagination parameters for the result set.
	 * @returns An Effect containing the requested page of Organizations.
	 */
	listOrganizations(
		query: OrganizationListQuery
	): Effect.Effect<Organization[], OrganizationInfrastructureError>;
	/**
	 * Finds an Organization by identifier.
	 *
	 * @param id - Organization to find.
	 * @returns An Effect containing the Organization when found, or `Option.none()` otherwise.
	 */
	getOrganization(
		id: OrgID
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError>;
	/**
	 * Creates an Organization from a validated domain record.
	 *
	 * @param record - Organization to persist.
	 * @returns An Effect containing the created Organization.
	 */
	createOrganization(
		record: Organization
	): Effect.Effect<Organization, OrganizationInfrastructureError>;
	/**
	 * Updates the mutable fields of an Organization.
	 *
	 * @param record - Organization state to persist.
	 * @returns An Effect containing the updated Organization, or `Option.none()` when absent.
	 */
	updateOrganization(
		record: Organization
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError>;
	/**
	 * Deletes an Organization by identifier.
	 *
	 * @param id - Organization to delete.
	 * @returns An Effect containing the deleted Organization, or `Option.none()` when absent.
	 */
	deleteOrganization(
		id: OrgID
	): Effect.Effect<Option.Option<Organization>, OrganizationDeleteRepositoryError>;
}

const OrganizationRepoTag = Context.Service<OrganizationRepo>("OrganizationRepo");

const mapInfrastructureError = (cause: unknown): OrganizationInfrastructureError =>
	isPostgresUnavailable(cause)
		? new OrganizationRepositoryUnavailable(cause)
		: new OrganizationPersistenceFailure(cause);

const mapDeleteError = (cause: unknown): OrganizationDeleteRepositoryError =>
	postgresErrorCode(cause) === "23503"
		? new OrganizationHasDependents()
		: mapInfrastructureError(cause);

/** PostgreSQL implementation of the Organization repository contract. */
class OrganizationRepoLive implements OrganizationRepo {
	/**
	 * Creates an Organization repository backed by Drizzle.
	 *
	 * @param db - Database used for all Organization reads and writes.
	 */
	constructor(private readonly db: DrizzleDatabase) {}

	/**
	 * Lists Organizations in ascending identifier order.
	 *
	 * @param query - Offset and limit for the result page.
	 * @returns An Effect containing decoded Organizations in stable order.
	 */
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

	/**
	 * Reads one Organization by identifier.
	 *
	 * @param id - Organization to read.
	 * @returns An Effect containing the decoded Organization, or `Option.none()` when absent.
	 */
	getOrganization(
		id: OrgID
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select()
					.from(OrganizationsTable)
					.where(eq(OrganizationsTable.id, encodeUuid(id)))
					.limit(1),
			catch: mapInfrastructureError,
		}).pipe(Effect.flatMap(rows => Organization.fromRow(rows[0])));
	}

	/**
	 * Inserts an Organization and requires PostgreSQL to return the created row.
	 *
	 * @param record - Organization to insert.
	 * @returns An Effect containing the inserted Organization.
	 */
	createOrganization(
		record: Organization
	): Effect.Effect<Organization, OrganizationInfrastructureError> {
		return Effect.tryPromise({
			try: () => this.db.insert(OrganizationsTable).values(record.toCreateRow()).returning(),
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

	/**
	 * Updates an Organization when its identifier matches an existing row.
	 *
	 * @param record - Organization state whose mutable fields will be persisted.
	 * @returns An Effect containing the updated Organization, or `Option.none()` when absent.
	 */
	updateOrganization(
		record: Organization
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.update(OrganizationsTable)
					.set(record.toUpdateRow())
					.where(eq(OrganizationsTable.id, encodeUuid(record.id)))
					.returning(),
			catch: mapInfrastructureError,
		}).pipe(Effect.flatMap(rows => Organization.fromRow(rows[0])));
	}

	/**
	 * Deletes an Organization and rejects Organizations with dependent records.
	 *
	 * @param id - Organization to delete.
	 * @returns An Effect containing the deleted Organization, or `Option.none()` when absent.
	 */
	deleteOrganization(
		id: OrgID
	): Effect.Effect<Option.Option<Organization>, OrganizationDeleteRepositoryError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.delete(OrganizationsTable)
					.where(eq(OrganizationsTable.id, encodeUuid(id)))
					.returning(),
			catch: mapDeleteError,
		}).pipe(Effect.flatMap(rows => Organization.fromRow(rows[0])));
	}
}

const organizationRepoLayer = Layer.effect(
	OrganizationRepoTag,
	DatabaseTag.pipe(Effect.map(database => new OrganizationRepoLive(database.db)))
);

export type { OrganizationDeleteRepositoryError, OrganizationListQuery };
export type { OrganizationInfrastructureError } from "./OrganizationErrors";
export { type OrganizationRepo, OrganizationRepoLive, OrganizationRepoTag, organizationRepoLayer };
