import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import type { OrgID } from "@/lib/ids";
import type {
	OrganizationInsertRow,
	OrganizationRow,
	OrganizationUpdateRow,
} from "../../db/schema";
import type { OrganizationResponse, OrganizationUpdateRequest } from "./OrganizationSchema";
import {
	type OrganizationInfrastructureError,
	OrganizationPersistenceDecodingFailure,
} from "./OrganizationErrors";
import { encodeUuid, parseDate, parseUuid } from "@/lib/utils";

type OrganizationOpts = {
	id: OrgID;
	name: string;
	description?: string;
	created?: DateTime;
	updated?: DateTime;
};

class Organization {
	readonly id: OrgID;
	readonly name: string;
	readonly description?: string;
	readonly created: DateTime;
	readonly updated: DateTime;

	private constructor({ id, name, description, created, updated }: OrganizationOpts) {
		this.id = id;
		this.name = name;
		this.description = description;
		this.created = created ?? DateTime.utc();
		this.updated = updated ?? DateTime.utc();
	}

	static fromRequest(id: OrgID, rq: OrganizationUpdateRequest) {
		return new Organization({
			id,
			name: rq.name,
			description: rq.description,
		});
	}

	static fromRow(
		row: OrganizationRow | undefined
	): Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError> {
		if (row === undefined) return Effect.succeed(Option.none());

		return Effect.gen(function* () {
			const id = yield* parseUuid<"org", OrgID>("org", row.id);
			const created = yield* parseDate(row.created);
			const updated = yield* parseDate(row.updated);

			const organization = new Organization({
				id,
				name: row.name,
				description: row.description ?? undefined,
				created,
				updated,
			});
			// eslint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives a value.
			return Option.some(organization);
		}).pipe(Effect.mapError(cause => new OrganizationPersistenceDecodingFailure(cause)));
	}

	toCreateRow(): OrganizationInsertRow {
		return {
			id: encodeUuid(this.id),
			name: this.name,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.description ?? null,
			created: this.created.toJSDate(),
			updated: this.updated.toJSDate(),
		};
	}

	toUpdateRow(): OrganizationUpdateRow {
		return {
			name: this.name,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.description ?? null,
			updated: this.updated.toJSDate(),
		};
	}

	toResponse(): OrganizationResponse {
		return {
			id: this.id.toString(),
			name: this.name,
			description: this.description ?? undefined,
			created: this.created.toISO(),
			updated: this.updated.toISO(),
		};
	}
}

export { Organization };
