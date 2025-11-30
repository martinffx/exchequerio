import type { InferSelectModel } from "drizzle-orm";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import type { OrganizationsTable } from "@/repo/schema";
import type { OrganizationRequest, OrganizationResponse } from "@/routes/schema";
import type { OrgID } from "./types";

type OrgRecord = InferSelectModel<typeof OrganizationsTable>;
interface OrgEntityOptions {
	id?: OrgID;
	name: string;
	description?: string;
	created?: DateTime;
	updated?: DateTime;
}

class OrganizationEntity {
	public readonly id: OrgID;
	public readonly name: string;
	public readonly description?: string;
	public readonly created?: DateTime;
	public readonly updated?: DateTime;

	constructor({ id, name, description, created, updated }: OrgEntityOptions) {
		this.id = id ?? new TypeID("org");
		this.name = name;
		this.description = description;
		this.created = created;
		this.updated = updated;
	}

	public static fromRow(row: OrgRecord): OrganizationEntity {
		const created = DateTime.fromJSDate(row.created, { zone: "utc" });
		if (!created.isValid) {
			throw new Error(`Invalid created date: ${created.toString()}`);
		}
		const updated = DateTime.fromJSDate(row.updated, { zone: "utc" });
		if (!updated.isValid) {
			throw new Error(`Invalid updated date: ${updated.toString()}`);
		}

		const orgId = TypeID.fromString<"org">(row.id);
		return new OrganizationEntity({
			id: orgId,
			name: row.name,
			description: row.description ?? undefined,
			created,
			updated,
		});
	}

	public static fromRequest(rq: OrganizationRequest, id?: string): OrganizationEntity {
		return new OrganizationEntity({
			id: id ? TypeID.fromString(id) : undefined,
			name: rq.name,
			description: rq.description,
		});
	}

	public update(rq: OrganizationRequest): OrganizationEntity {
		return new OrganizationEntity({
			id: this.id,
			name: rq.name,
			description: rq.description ?? this.description,
			created: this.created,
			updated: DateTime.utc(),
		});
	}

	public toResponse(): OrganizationResponse {
		return {
			id: this.id.toString(),
			name: this.name,
			description: this.description ?? undefined,
			created: this.created?.toISO() ?? "",
			updated: this.updated?.toISO() ?? "",
		};
	}
}

export type { OrgEntityOptions as OrgEntityOpts };
export { OrganizationEntity };

export type { OrgID } from "./types";
