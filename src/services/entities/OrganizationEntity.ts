import type { SelectOrganization } from "@/repo/schema"
import type { OrganizationRequest, OrganizationResponse } from "@/routes/schema"
import { DateTime } from "luxon"
import { TypeID } from "typeid-js"

type OrgID = TypeID<"org">
interface OrgEntityOpts {
	id?: OrgID
	name: string
	description?: string
	created?: DateTime
	updated?: DateTime
}

class OrganizationEntity {
	public readonly id: OrgID
	public readonly name: string
	public readonly description?: string
	public readonly created?: DateTime
	public readonly updated?: DateTime

	constructor({ id, name, description, created, updated }: OrgEntityOpts) {
		this.id = id ?? new TypeID("org")
		this.name = name
		this.description = description
		this.created = created
		this.updated = updated
	}

	public static fromRow(row: SelectOrganization): OrganizationEntity {
		const created = DateTime.fromJSDate(row.created, { zone: "utc" })
		if (!created.isValid) {
			throw new Error(`Invalid created date: ${created}`)
		}
		const updated = DateTime.fromJSDate(row.updated, { zone: "utc" })
		if (!updated.isValid) {
			throw new Error(`Invalid updated date: ${updated}`)
		}

		const orgId = TypeID.fromUUID("org", row.id)
		return new OrganizationEntity({
			id: orgId,
			name: row.name,
			description: row.description ?? undefined,
			created,
			updated,
		})
	}

	public static fromRequest(rq: OrganizationRequest, id?: string): OrganizationEntity {
		return new OrganizationEntity({
			id: id ? TypeID.fromString(id) : undefined,
			name: rq.name,
			description: rq.description,
		})
	}

	public update(rq: OrganizationRequest): OrganizationEntity {
		return new OrganizationEntity({
			id: this.id,
			name: rq.name,
			description: rq.description ?? this.description,
			created: this.created,
			updated: DateTime.utc(),
		})
	}

	public toResponse(): OrganizationResponse {
		return {
			id: this.id.toString(),
			name: this.name,
			description: this.description ?? undefined,
			created: this.created?.toISO() ?? "",
			updated: this.updated?.toISO() ?? "",
		}
	}
}

export type { OrgID, OrgEntityOpts }
export { OrganizationEntity }
