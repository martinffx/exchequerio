import { Schema } from "effect";
import { AssetCodeSchema, AssetIdSchema, MinorUnitExponentSchema } from "@/lib/AssetSchema";
import { ListQuery } from "@/lib/ListQuery";
import { MetadataSchema, OmittedWhenUndefined } from "@/lib/schema";

const AssetNameSchema = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/[^ ]/));
// Unknown fields are rejected rather than stripped (was `additionalProperties: false`).
const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const mutableFields = {
	code: AssetCodeSchema,
	name: AssetNameSchema,
	description: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(MetadataSchema),
};
const AssetCreateRequest = Schema.Struct({
	...mutableFields,
	minorUnitExponent: MinorUnitExponentSchema,
}).annotate(strict);
const AssetUpdateRequest = Schema.Struct(mutableFields).annotate(strict);
const AssetIdParameters = Schema.Struct({ assetId: AssetIdSchema });
const AssetListQuery = Schema.Struct({
	...ListQuery.fields,
	code: Schema.optionalKey(AssetCodeSchema),
});
const AssetResponse = Schema.Struct({
	id: AssetIdSchema,
	code: AssetCodeSchema,
	name: AssetNameSchema,
	description: OmittedWhenUndefined(Schema.String),
	metadata: OmittedWhenUndefined(MetadataSchema),
	minorUnitExponent: MinorUnitExponentSchema,
	created: Schema.String.annotate({ format: "date-time" }),
	updated: Schema.String.annotate({ format: "date-time" }),
});

type AssetCreateRequest = typeof AssetCreateRequest.Type;
type AssetUpdateRequest = typeof AssetUpdateRequest.Type;
type AssetIdParameters = typeof AssetIdParameters.Type;
type AssetListQuery = typeof AssetListQuery.Type;
type AssetResponse = typeof AssetResponse.Type;

export { AssetCreateRequest, AssetIdParameters, AssetListQuery, AssetResponse, AssetUpdateRequest };
