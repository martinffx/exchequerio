import { OrganizationsTable } from "./schema"
import { eq } from "drizzle-orm"
import type { DrizzleDB } from "./types"
import { DateTime } from "luxon"
import { ConflictError, InternalServerError, LedgerError, NotFoundError } from "@/errors"
import { DatabaseError } from "pg"
import { typeid } from "typeid-js"
import { OrganizationEntity, type OrgID } from "@/services"
const tid = typeid("prefix")

class OrganizationRepo {
	constructor(private readonly db: DrizzleDB) {}

	public async listOrganizations(offset = 0, limit = 20): Promise<OrganizationEntity[]> {
		const orgs = await this.db.select().from(OrganizationsTable).limit(limit).offset(offset)

		return orgs.map(OrganizationEntity.fromRow)
	}

	public async getOrganization(id: OrgID): Promise<OrganizationEntity> {
		const orgs = await this.db
			.select()
			.from(OrganizationsTable)
			.where(eq(OrganizationsTable.id, id.toUUID()))
			.limit(1)
		if (!orgs.length) {
			throw new NotFoundError(`Organization with id ${id} not found`)
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
		} catch (ex: unknown) {
			if (ex instanceof LedgerError) {
				throw ex
			}

			if (ex instanceof DatabaseError) {
				throw new ConflictError(`Organization with id ${record.id} already exists`)
			}

			if (ex instanceof Error) {
				throw new InternalServerError(ex.message)
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
				throw new NotFoundError(`Organization with id ${id} not found`)
			}
			return OrganizationEntity.fromRow(organization)
		} catch (ex: unknown) {
			if (ex instanceof LedgerError) {
				throw ex
			}

			if (ex instanceof Error) {
				throw new InternalServerError(ex.message)
			}

			throw new InternalServerError("Unknown error")
		}
	}

	public async deleteOrganization(id: OrgID): Promise<void> {
		await this.db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id.toUUID()))
	}
}

export { OrganizationRepo, OrganizationEntity }
