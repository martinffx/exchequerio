import type { AssetSummary } from "@/lib/AssetSchema";
import { encodeUuid } from "@/lib/utils";
import { TypeID } from "typeid-js";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
	DatabaseTag,
	type EffectDrizzleDatabase,
	isPostgresUnavailable,
	postgresErrorCode,
} from "@/db";
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";
import type { OrgID } from "@/lib/ids";
import { AssetsTable } from "@/db/schema";
import { Asset } from "./Asset";
import type { AssetListQuery } from "./AssetSchema";

const mapError = (cause: unknown) =>
	isPostgresUnavailable(cause)
		? new ServiceUnavailableError("Asset repository unavailable", { cause })
		: new InternalServerError("Asset persistence operation failed", { cause });
const mapWriteError = (cause: unknown) =>
	postgresErrorCode(cause) === "23505"
		? new ConflictError("Asset code already exists", { cause })
		: postgresErrorCode(cause) === "23503"
			? new NotFoundError("Organization not found", { cause })
			: mapError(cause);
const requireRow = (
	rows: (typeof AssetsTable.$inferSelect)[]
): Effect.Effect<Asset, NotFoundError | InternalServerError> =>
	rows[0] ? Asset.fromRow(rows[0]) : Effect.fail(new NotFoundError("Asset not found"));

export class AssetRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}
	listAssets(orgId: OrgID, query: AssetListQuery) {
		return this.db
			.select()
			.from(AssetsTable)
			.where(
				and(
					eq(AssetsTable.organizationId, encodeUuid(orgId)),
					query.code === undefined ? undefined : eq(AssetsTable.code, query.code)
				)
			)
			.orderBy(asc(AssetsTable.id))
			.offset(query.offset)
			.limit(query.limit)
			.pipe(
				Effect.mapError(mapError),
				Effect.flatMap(rows => Effect.all(rows.map(row => Asset.fromRow(row))))
			);
	}
	getAsset(orgId: OrgID, id: string) {
		return this.db
			.select()
			.from(AssetsTable)
			.where(
				and(
					eq(AssetsTable.organizationId, encodeUuid(orgId)),
					eq(AssetsTable.id, encodeUuid(TypeID.fromString(id)))
				)
			)
			.limit(1)
			.pipe(Effect.mapError(mapError), Effect.flatMap(requireRow));
	}
	findAssets(orgId: OrgID, ids: string[], codes: string[]) {
		return this.db
			.select({
				assetId: AssetsTable.id,
				assetCode: AssetsTable.code,
				minorUnitExponent: AssetsTable.minorUnitExponent,
			})
			.from(AssetsTable)
			.where(
				and(
					eq(AssetsTable.organizationId, encodeUuid(orgId)),
					or(
						inArray(
							AssetsTable.id,
							ids.map(id => encodeUuid(TypeID.fromString(id)))
						),
						inArray(AssetsTable.code, codes)
					)
				)
			)
			.pipe(
				Effect.mapError(mapError),
				Effect.map(rows =>
					rows.map(
						(row): AssetSummary => ({ ...row, assetId: TypeID.fromUUID("ast", row.assetId).toString() })
					)
				)
			);
	}
	createAsset(asset: Asset) {
		return this.db
			.insert(AssetsTable)
			.values(asset.toRow())
			.returning()
			.pipe(Effect.mapError(mapWriteError), Effect.flatMap(requireRow));
	}
	updateAsset(asset: Asset) {
		const { code, name, description, metadata, updated } = asset.toRow();
		return this.db
			.update(AssetsTable)
			.set({ code, name, description, metadata, updated })
			.where(
				and(
					eq(AssetsTable.organizationId, encodeUuid(asset.organizationId)),
					eq(AssetsTable.id, encodeUuid(TypeID.fromString(asset.id)))
				)
			)
			.returning()
			.pipe(Effect.mapError(mapWriteError), Effect.flatMap(requireRow));
	}
	deleteAsset(orgId: OrgID, id: string) {
		return this.db
			.delete(AssetsTable)
			.where(
				and(
					eq(AssetsTable.organizationId, encodeUuid(orgId)),
					eq(AssetsTable.id, encodeUuid(TypeID.fromString(id)))
				)
			)
			.returning()
			.pipe(
				Effect.mapError(cause =>
					postgresErrorCode(cause) === "23503"
						? new ConflictError("Asset is referenced by an Account", { cause })
						: mapError(cause)
				),
				Effect.flatMap(requireRow)
			);
	}
}
export const AssetRepoTag = Context.Service<AssetRepo>("AssetRepo");
export const assetRepoLayer = Layer.effect(
	AssetRepoTag,
	DatabaseTag.pipe(Effect.map(database => new AssetRepo(database.effectDb)))
);
