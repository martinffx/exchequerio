import { Context, Effect, Layer } from "effect";
import { normalizeAssetCode, type AssetSelector, type AssetSummary } from "@/lib/AssetSchema";
import { NotFoundError } from "@/lib/errors";
import { newAssetID, type OrgID } from "@/lib/ids";
import { Asset } from "./Asset";
import { AssetRepo, AssetRepoTag } from "./AssetRepo";
import type { AssetCreateRequest, AssetUpdateRequest, AssetListQuery } from "./AssetSchema";

export class AssetService {
	constructor(private readonly repository: AssetRepo) {}
	listAssets(orgId: OrgID, query: AssetListQuery) {
		return this.repository.listAssets(orgId, {
			...query,
			code: query.code === undefined ? undefined : normalizeAssetCode(query.code),
		});
	}
	getAsset(orgId: OrgID, id: string) {
		return this.repository.getAsset(orgId, id);
	}
	createAsset(orgId: OrgID, request: AssetCreateRequest) {
		return Effect.suspend(() =>
			this.repository.createAsset(
				Asset.fromRequest(newAssetID().toString(), orgId, request, new Date())
			)
		);
	}
	updateAsset(orgId: OrgID, id: string, request: AssetUpdateRequest) {
		return this.repository
			.getAsset(orgId, id)
			.pipe(Effect.flatMap(asset => this.repository.updateAsset(asset.replace(request, new Date()))));
	}
	deleteAsset(orgId: OrgID, id: string) {
		return this.repository.deleteAsset(orgId, id);
	}
	resolveAssets(orgId: OrgID, selectors: readonly AssetSelector[]) {
		if (selectors.length === 0) return Effect.succeed<AssetSummary[]>([]);
		const ids = [
			...new Set(
				selectors.flatMap(selector => (selector.assetId !== undefined ? [selector.assetId] : []))
			),
		];
		const codes = [
			...new Set(
				selectors.flatMap(selector =>
					selector.assetCode !== undefined ? [normalizeAssetCode(selector.assetCode)] : []
				)
			),
		];
		return this.repository.findAssets(orgId, ids, codes).pipe(
			Effect.flatMap(assets => {
				const byId = new Map(assets.map(asset => [asset.assetId, asset]));
				const byCode = new Map(assets.map(asset => [asset.assetCode, asset]));
				const result: AssetSummary[] = [];
				for (const selector of selectors) {
					const asset =
						selector.assetId !== undefined
							? byId.get(selector.assetId)
							: byCode.get(normalizeAssetCode(selector.assetCode));
					if (asset === undefined) return Effect.fail(new NotFoundError("Asset not found"));
					result.push(asset);
				}
				return Effect.succeed(result);
			})
		);
	}
}
export const AssetServiceTag = Context.Service<AssetService>("AssetService");
export const assetServiceLayer = Layer.effect(
	AssetServiceTag,
	AssetRepoTag.pipe(Effect.map(repository => new AssetService(repository)))
);

export type AssetResolveError = Effect.Error<ReturnType<AssetService["resolveAssets"]>>;
