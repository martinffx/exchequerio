import { encodeUuid } from "@/lib/utils";
import { Effect } from "effect";
import { TypeID } from "typeid-js";
import { InternalServerError } from "@/lib/errors";
import { normalizeAssetCode, type AssetSummary } from "@/lib/AssetSchema";
import type { OrgID } from "@/lib/ids";
import type { AssetRow, AssetInsertRow } from "@/db/schema";
import type { AssetCreateRequest, AssetUpdateRequest, AssetResponse } from "./AssetSchema";

export class Asset {
	constructor(
		readonly organizationId: OrgID,
		private readonly value: AssetResponse
	) {}
	get id(): string {
		return this.value.id;
	}
	static fromRequest(
		id: string,
		organizationId: OrgID,
		request: AssetCreateRequest,
		now: Date
	): Asset {
		return new Asset(organizationId, {
			...request,
			code: normalizeAssetCode(request.code),
			id,
			created: now.toISOString(),
			updated: now.toISOString(),
		});
	}
	static fromRow(row: AssetRow): Effect.Effect<Asset, InternalServerError> {
		return Effect.try({
			try: () => {
				const organizationId = TypeID.fromUUID("org", row.organizationId) as OrgID;
				const metadata: unknown = row.metadata === null ? undefined : JSON.parse(row.metadata);
				if (
					metadata !== undefined &&
					(typeof metadata !== "object" ||
						metadata === null ||
						Array.isArray(metadata) ||
						!Object.values(metadata).every(value => typeof value === "string"))
				)
					throw new Error("Invalid Asset metadata");
				return new Asset(organizationId, {
					id: TypeID.fromUUID("ast", row.id).toString(),
					code: row.code,
					name: row.name,
					minorUnitExponent: row.minorUnitExponent,
					description: row.description ?? undefined,
					metadata: metadata as Record<string, string> | undefined,
					created: row.created.toISOString(),
					updated: row.updated.toISOString(),
				});
			},
			catch: cause => new InternalServerError("Persisted Asset could not be decoded", { cause }),
		});
	}
	replace(request: AssetUpdateRequest, now: Date): Asset {
		return new Asset(this.organizationId, {
			...request,
			code: normalizeAssetCode(request.code),
			id: this.id,
			minorUnitExponent: this.value.minorUnitExponent,
			created: this.value.created,
			updated: now.toISOString(),
		});
	}
	toRow(): AssetInsertRow {
		return {
			id: encodeUuid(TypeID.fromString(this.id)),
			organizationId: encodeUuid(this.organizationId),
			code: this.value.code,
			name: this.value.name,
			minorUnitExponent: this.value.minorUnitExponent,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.value.description ?? null,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			metadata: this.value.metadata === undefined ? null : JSON.stringify(this.value.metadata),
			created: new Date(this.value.created),
			updated: new Date(this.value.updated),
		};
	}
	toResponse(): AssetResponse {
		return { ...this.value };
	}
	toSummary(): AssetSummary {
		return {
			assetId: this.id,
			assetCode: this.value.code,
			minorUnitExponent: this.value.minorUnitExponent,
		};
	}
}
