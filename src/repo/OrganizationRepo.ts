import { eq } from "drizzle-orm"
import { DateTime } from "luxon"
import { DatabaseError } from "pg"
import { typeid } from "typeid-js"
import { ConflictError, InternalServerError, LedgerError, NotFoundError } from "@/errors"
import { OrganizationEntity, type OrgID } from "@/services"
import { OrganizationsTable } from "./schema"
import type { DrizzleDB } from "./types"

const _tid = typeid("prefix")

class OrganizationRepo {
	constructor(private readonly db: DrizzleDB) {}

	public async listOrganizations(offset = 0, limit = 20): Promise<OrganizationEntity[]> {
		const orgs = await this.db.select().from(OrganizationsTable).limit(limit).offset(offset)

		return orgs.map(org => OrganizationEntity.fromRow(org))
	}

	public async getOrganization(id: OrgID): Promise<OrganizationEntity> {
		const orgs = await this.db
			.select()
			.from(OrganizationsTable)
			.where(eq(OrganizationsTable.id, id.toUUID()))
			.limit(1)
		if (!orgs.length) {
			throw new NotFoundError(`Organization with id ${id.toString()} not found`)
		}
		return OrganizationEntity.fromRow(orgs[0])
	}

	public async createOrganization(record: OrganizationEntity): Promise<OrganizationEntity> {
		try {
			const [organization] = await this.db
				.insert(OrganizationsTable)
				.values({
					id: record.id.toUUID(),
					name: record.name,
					description: record.description,
				})
				.returning()
			return OrganizationEntity.fromRow(organization)
		} catch (error: unknown) {
			if (error instanceof LedgerError) {
				throw error
			}

			if (error instanceof DatabaseError) {
				throw new ConflictError(`Organization with id ${record.id.toString()} already exists`)
			}

			if (error instanceof Error) {
				throw new InternalServerError(error.message)
			}

			throw new InternalServerError("Unknown error")
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
				.where(eq(OrganizationsTable.id, id.toUUID()))
				.returning()
			if (organization === undefined) {
				throw new NotFoundError(`Organization with id ${id.toString()} not found`)
			}
			return OrganizationEntity.fromRow(organization)
		} catch (error: unknown) {
			if (error instanceof LedgerError) {
				throw error
			}

			if (error instanceof Error) {
				throw new InternalServerError(error.message)
			}

			throw new InternalServerError("Unknown error")
		}
	}

	public async deleteOrganization(id: OrgID): Promise<void> {
		await this.db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id.toUUID()))
	}
}

export { OrganizationRepo }

export { OrganizationEntity } from "@/services"
