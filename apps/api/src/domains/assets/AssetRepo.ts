import { encodeUuid } from "@/lib/utils";
import { and, asc, eq } from "drizzle-orm";
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
import type { AssetID, OrgID } from "@/lib/ids";
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

	getAsset(orgId: OrgID, reference: AssetID | string) {
		return this.db
			.select()
			.from(AssetsTable)
			.where(
				and(
					eq(AssetsTable.organizationId, encodeUuid(orgId)),
					typeof reference === "string"
						? eq(AssetsTable.code, reference)
						: eq(AssetsTable.id, encodeUuid(reference))
				)
			)
			.limit(1)
			.pipe(Effect.mapError(mapError), Effect.flatMap(requireRow));
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
					eq(AssetsTable.id, encodeUuid(asset.id))
				)
			)
			.returning()
			.pipe(Effect.mapError(mapWriteError), Effect.flatMap(requireRow));
	}

	deleteAsset(orgId: OrgID, id: AssetID) {
		return this.db
			.delete(AssetsTable)
			.where(
				and(eq(AssetsTable.organizationId, encodeUuid(orgId)), eq(AssetsTable.id, encodeUuid(id)))
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
