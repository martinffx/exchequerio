import { Effect } from "effect";
import type { DateTime } from "luxon";
import type { AssetRow, AssetInsertRow } from "@/db/schema";
import { normalizeAssetCode, type AssetSummary } from "@/lib/AssetSchema";
import { InternalServerError } from "@/lib/errors";
import type { AssetID, OrgID } from "@/lib/ids";
import type { Metadata } from "@/lib/schema";
import { encodeMetadata, encodeUuid, parseDate, parseMetadata, parseUuid } from "@/lib/utils";
import type { AssetCreateRequest, AssetUpdateRequest, AssetResponse } from "./AssetSchema";

type AssetOptions = Omit<AssetCreateRequest, "metadata"> & {
	id: AssetID;
	organizationId: OrgID;
	metadata?: Metadata;
	created: DateTime;
	updated: DateTime;
};

export class Asset {
	readonly id: AssetID;
	readonly organizationId: OrgID;
	readonly code: string;
	readonly name: string;
	readonly minorUnitExponent: number;
	readonly description?: string;
	readonly metadata?: Metadata;
	readonly created: DateTime;
	readonly updated: DateTime;

	private constructor(options: AssetOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.code = options.code;
		this.name = options.name;
		this.minorUnitExponent = options.minorUnitExponent;
		this.description = options.description;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	static fromRequest(
		id: AssetID,
		organizationId: OrgID,
		request: AssetCreateRequest,
		now: DateTime
	): Asset {
		const created = now.toUTC();
		return new Asset({
			...request,
			id,
			organizationId,
			code: normalizeAssetCode(request.code),
			created,
			updated: created,
		});
	}

	static fromRow(row: AssetRow): Effect.Effect<Asset, InternalServerError> {
		return Effect.all({
			id: parseUuid<"ast", AssetID>("ast", row.id),
			organizationId: parseUuid<"org", OrgID>("org", row.organizationId),
			metadata: parseMetadata(row.metadata),
			created: parseDate(row.created),
			updated: parseDate(row.updated),
		}).pipe(
			Effect.map(
				decoded =>
					new Asset({
						...decoded,
						code: row.code,
						name: row.name,
						minorUnitExponent: row.minorUnitExponent,
						description: row.description ?? undefined,
					})
			),
			Effect.mapError(
				cause => new InternalServerError("Persisted Asset could not be decoded", { cause })
			)
		);
	}

	replace(request: AssetUpdateRequest, now: DateTime): Asset {
		return new Asset({
			...request,
			id: this.id,
			organizationId: this.organizationId,
			code: normalizeAssetCode(request.code),
			minorUnitExponent: this.minorUnitExponent,
			created: this.created,
			updated: now.toUTC(),
		});
	}

	toRow(): AssetInsertRow {
		return {
			id: encodeUuid(this.id),
			organizationId: encodeUuid(this.organizationId),
			code: this.code,
			name: this.name,
			minorUnitExponent: this.minorUnitExponent,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.description ?? null,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			metadata: encodeMetadata(this.metadata) ?? null,
			created: this.created.toJSDate(),
			updated: this.updated.toJSDate(),
		};
	}

	toResponse(): AssetResponse {
		return {
			id: this.id.toString(),
			code: this.code,
			name: this.name,
			minorUnitExponent: this.minorUnitExponent,
			description: this.description,
			metadata: this.metadata,
			created: this.created.toISO(),
			updated: this.updated.toISO(),
		};
	}

	toSummary(): AssetSummary {
		return {
			assetId: this.id.toString(),
			assetCode: this.code,
			minorUnitExponent: this.minorUnitExponent,
		};
	}
}
