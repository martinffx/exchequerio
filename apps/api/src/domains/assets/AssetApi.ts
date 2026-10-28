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

// 409 on update is a service failure (duplicate code) that the routes have always declared.
const AssetsApi = HttpApiGroup.make("assets")
	.add(
		HttpApiEndpoint.get("list", "/assets/", {
			query: AssetListQuery,
			success: Schema.Array(AssetResponse),
			error: commonErrors,
		}).annotateMerge(operation("listAssets", "List Assets")),
		HttpApiEndpoint.get("get", "/assets/:assetId", {
			params: AssetIdParameters,
			success: AssetResponse,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("getAsset", "Get an Asset")),
		HttpApiEndpoint.post("create", "/assets/", {
			payload: AssetCreateRequest,
			success: HttpApiSchema.WithHeaders(AssetResponse.pipe(HttpApiSchema.status(201)), {
				location: Schema.String,
			}),
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("createAsset", "Create an Asset")),
		HttpApiEndpoint.put("update", "/assets/:assetId", {
			params: AssetIdParameters,
			payload: AssetUpdateRequest,
			success: AssetResponse,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("updateAsset", "Replace an Asset")),
		HttpApiEndpoint.delete("delete", "/assets/:assetId", {
			params: AssetIdParameters,
			success: HttpApiSchema.NoContent,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("deleteAsset", "Delete an Asset"))
	)
	.annotateMerge(OpenApi.annotations({ title: "Assets" }));

export { AssetsApi };
