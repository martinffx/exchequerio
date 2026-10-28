import { Effect } from "effect";
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { CurrentToken, requirePermissions } from "@/auth";
import type { AssetID } from "@/lib/ids";
import { parseId } from "@/lib/utils";
import { AssetServiceTag } from "./AssetService";

const AssetRoutes = HttpApiBuilder.group(LedgerApi, "assets", handlers =>
	Effect.gen(function* () {
		const service = yield* AssetServiceTag;
		return handlers
			.handle("listAssets", ({ query }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["asset:read"]);
					const token = yield* CurrentToken;
					const assets = yield* service.listAssets(token.orgId, query);
					return assets.map(asset => asset.toResponse());
				})
			)
			.handle("getAsset", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["asset:read"]);
					const token = yield* CurrentToken;
					const assetId = yield* parseId<"ast", AssetID>("ast", params.assetId);
					const asset = yield* service.getAsset(token.orgId, assetId);
					return asset.toResponse();
				})
			)
			.handle("createAsset", ({ payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["asset:write"]);
					const token = yield* CurrentToken;
					const asset = yield* service.createAsset(token.orgId, payload);
					return HttpApiSchema.withHeaders({
						body: asset.toResponse(),
						headers: { location: `/api/assets/${asset.id.toString()}` },
					});
				})
			)
			.handle("updateAsset", ({ params, payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["asset:write"]);
					const token = yield* CurrentToken;
					const assetId = yield* parseId<"ast", AssetID>("ast", params.assetId);
					const asset = yield* service.updateAsset(token.orgId, assetId, payload);
					return asset.toResponse();
				})
			)
			.handle("deleteAsset", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["asset:delete"]);
					const token = yield* CurrentToken;
					const assetId = yield* parseId<"ast", AssetID>("ast", params.assetId);
					yield* service.deleteAsset(token.orgId, assetId);
				})
			);
	})
);

export { AssetRoutes };
