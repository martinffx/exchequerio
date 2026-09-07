import { type Static, Type } from "@sinclair/typebox";
import { AssetCodeSchema, AssetIdSchema, MinorUnitExponentSchema } from "@/lib/AssetSchema";
import { ListQuery } from "@/lib/ListQuery";
import { MetadataSchema } from "@/lib/schema";

const mutableFields = {
	code: AssetCodeSchema,
	name: Type.String({ minLength: 1, pattern: "[^ ]" }),
	description: Type.Optional(Type.String()),
	metadata: Type.Optional(MetadataSchema),
};
export const AssetCreateRequest = Type.Object(
	{ ...mutableFields, minorUnitExponent: MinorUnitExponentSchema },
	{ additionalProperties: false }
);
export const AssetUpdateRequest = Type.Object(mutableFields, { additionalProperties: false });
export const AssetIdParameters = Type.Object({ assetId: AssetIdSchema });
export const AssetListQuery = Type.Object({
	...ListQuery.properties,
	code: Type.Optional(AssetCodeSchema),
});
export const AssetResponse = Type.Object({
	...mutableFields,
	id: AssetIdSchema,
	minorUnitExponent: MinorUnitExponentSchema,
	created: Type.String({ format: "date-time" }),
	updated: Type.String({ format: "date-time" }),
});
export type AssetCreateRequest = Static<typeof AssetCreateRequest>;
export type AssetUpdateRequest = Static<typeof AssetUpdateRequest>;
export type AssetIdParameters = Static<typeof AssetIdParameters>;
export type AssetListQuery = Static<typeof AssetListQuery>;
export type AssetResponse = Static<typeof AssetResponse>;
