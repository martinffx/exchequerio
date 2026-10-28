import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { normalizeAssetCode } from "@/lib/AssetSchema";
import { newAssetID, type AssetID, type OrgID } from "@/lib/ids";
import { Asset } from "./Asset";
import { AssetRepo, AssetRepoTag } from "./AssetRepo";
import type { AssetCreateRequest, AssetUpdateRequest, AssetListQuery } from "./AssetSchema";

export class AssetService {
	constructor(private readonly repository: AssetRepo) {}

	listAssets(orgId: OrgID, query: AssetListQuery) {
		return Effect.suspend(() =>
			this.repository.listAssets(orgId, {
				...query,
				code: query.code === undefined ? undefined : normalizeAssetCode(query.code),
			})
		).pipe(
			Effect.withSpan("AssetService.listAssets", { attributes: { "organization.id": String(orgId) } })
		);
	}

	getAsset(orgId: OrgID, reference: AssetID | string) {
		return Effect.suspend(() =>
			this.repository.getAsset(
				orgId,
				typeof reference === "string" ? normalizeAssetCode(reference) : reference
			)
		).pipe(
			Effect.withSpan("AssetService.getAsset", { attributes: { "organization.id": String(orgId) } })
		);
	}

	createAsset(orgId: OrgID, request: AssetCreateRequest) {
		return Effect.suspend(() =>
			this.repository.createAsset(Asset.fromRequest(newAssetID(), orgId, request, DateTime.utc()))
		).pipe(
			Effect.withSpan("AssetService.createAsset", { attributes: { "organization.id": String(orgId) } })
		);
	}

	updateAsset(orgId: OrgID, id: AssetID, request: AssetUpdateRequest) {
		return Effect.suspend(() =>
			this.repository
				.getAsset(orgId, id)
				.pipe(
					Effect.flatMap(asset => this.repository.updateAsset(asset.replace(request, DateTime.utc())))
				)
		).pipe(
			Effect.withSpan("AssetService.updateAsset", { attributes: { "organization.id": String(orgId) } })
		);
	}

	deleteAsset(orgId: OrgID, id: AssetID) {
		return Effect.suspend(() => this.repository.deleteAsset(orgId, id)).pipe(
			Effect.withSpan("AssetService.deleteAsset", { attributes: { "organization.id": String(orgId) } })
		);
	}
}

export const AssetServiceTag = Context.Service<AssetService>("AssetService");
export const assetServiceLayer = Layer.effect(
	AssetServiceTag,
	AssetRepoTag.pipe(Effect.map(repository => new AssetService(repository)))
);

export type AssetGetError = Effect.Error<ReturnType<AssetService["getAsset"]>>;
