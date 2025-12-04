import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { DatabaseError } from "pg";
import { typeid } from "typeid-js";
import { ConflictError, InternalServerError, LedgerError, NotFoundError } from "@/errors";
import { OrganizationEntity, type OrgID } from "@/services";
import { OrganizationsTable } from "./schema";
import type { DrizzleDB } from "./types";

const _tid = typeid("prefix");

class OrganizationRepo {
	constructor(private readonly db: DrizzleDB) {}

	public async listOrganizations(offset = 0, limit = 20): Promise<OrganizationEntity[]> {
		const orgs = await this.db.select().from(OrganizationsTable).limit(limit).offset(offset);

		return orgs.map(org => OrganizationEntity.fromRecord(org));
	}

	public async getOrganization(id: OrgID): Promise<OrganizationEntity> {
		const orgs = await this.db
			.select()
			.from(OrganizationsTable)
			.where(eq(OrganizationsTable.id, id.toString()))
			.limit(1);
		if (!orgs.length) {
			throw new NotFoundError(`Organization with id ${id.toString()} not found`);
		}
		return OrganizationEntity.fromRecord(orgs[0]);
	}

	public async createOrganization(record: OrganizationEntity): Promise<OrganizationEntity> {
		try {
			const [organization] = await this.db
				.insert(OrganizationsTable)
				.values({
					id: record.id.toString(),
					name: record.name,
					description: record.description,
				})
				.returning();
			return OrganizationEntity.fromRecord(organization);
		} catch (error: unknown) {
			if (error instanceof LedgerError) {
				throw error;
			}

			// Drizzle wraps PostgreSQL errors, check the cause for the original error
			if (error && typeof error === "object" && "cause" in error) {
				const errorWithCause = error as { cause?: unknown };
				if (
					errorWithCause.cause &&
					typeof errorWithCause.cause === "object" &&
					"code" in errorWithCause.cause
				) {
					const cause = errorWithCause.cause as { code?: string };
					if (cause.code === "23505") {
						throw new ConflictError({
							message: `Organization with id ${record.id.toString()} already exists`,
						});
					}
				}
			}

			// Also check direct DatabaseError instances (backwards compatibility)
			if (error instanceof DatabaseError) {
				if (error.code === "23505") {
					throw new ConflictError({
						message: `Organization with id ${record.id.toString()} already exists`,
					});
				}
				throw new InternalServerError(error.message);
			}

			// Check if error has a 'code' property (for other wrapped errors)
			if (error && typeof error === "object" && "code" in error) {
				const dbError = error as { code?: string; message?: string };
				if (dbError.code === "23505") {
					throw new ConflictError({
						message: `Organization with id ${record.id.toString()} already exists`,
					});
				}
			}

			if (error instanceof Error) {
				throw new InternalServerError(error.message);
			}

			throw new InternalServerError("Unknown error");
		}
	}

	public async updateOrganization(
		id: OrgID,
		record: OrganizationEntity
	): Promise<OrganizationEntity> {
		try {
			const [organization] = await this.db
				.update(OrganizationsTable)
				.set({
					name: record.name,
					description: record.description,
					updated: record.updated?.toJSDate() ?? DateTime.utc().toJSDate(),
				})
				.where(eq(OrganizationsTable.id, id.toString()))
				.returning();
			if (organization === undefined) {
				throw new NotFoundError(`Organization with id ${id.toString()} not found`);
			}
			return OrganizationEntity.fromRecord(organization);
		} catch (error: unknown) {
			if (error instanceof LedgerError) {
				throw error;
			}

			if (error instanceof Error) {
				throw new InternalServerError(error.message);
			}

			throw new InternalServerError("Unknown error");
		}
	}

	public async deleteOrganization(id: OrgID): Promise<void> {
		await this.db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id.toString()));
	}
}

export { OrganizationRepo };

export { OrganizationEntity } from "@/services";
