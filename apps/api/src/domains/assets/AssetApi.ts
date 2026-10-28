import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { ConflictApiError, NotFoundApiError } from "@/lib/errors";
import { commonErrors, operation } from "@/lib/ApiContract";
import {
	AssetCreateRequest,
	AssetIdParameters,
	AssetListQuery,
	AssetResponse,
	AssetUpdateRequest,
} from "./AssetSchema";

// Collection paths keep their trailing slash, as today's OpenAPI document has it.

// Endpoint names equal operation ids: the schema-error transform in api.ts branches on them.
// 409 on update is a service failure (duplicate code) that the routes have always declared.
const AssetsApi = HttpApiGroup.make("assets")
	.add(
		HttpApiEndpoint.get("listAssets", "/assets/", {
			query: AssetListQuery,
			success: Schema.Array(AssetResponse),
			error: commonErrors,
		}).annotateMerge(operation("listAssets", "List Assets")),
		HttpApiEndpoint.get("getAsset", "/assets/:assetId", {
			params: AssetIdParameters,
			success: AssetResponse,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("getAsset", "Get an Asset")),
		HttpApiEndpoint.post("createAsset", "/assets/", {
			payload: AssetCreateRequest,
			success: HttpApiSchema.WithHeaders(AssetResponse.pipe(HttpApiSchema.status(201)), {
				location: Schema.String,
			}),
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("createAsset", "Create an Asset")),
		HttpApiEndpoint.put("updateAsset", "/assets/:assetId", {
			params: AssetIdParameters,
			payload: AssetUpdateRequest,
			success: AssetResponse,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("updateAsset", "Replace an Asset")),
		HttpApiEndpoint.delete("deleteAsset", "/assets/:assetId", {
			params: AssetIdParameters,
			success: HttpApiSchema.NoContent,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("deleteAsset", "Delete an Asset"))
	)
	.annotateMerge(OpenApi.annotations({ title: "Assets" }));

export { AssetsApi };
