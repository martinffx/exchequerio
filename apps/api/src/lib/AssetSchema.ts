import { type Static, Type } from "@sinclair/typebox";

const AssetIdSchema = Type.String({ pattern: "^ast_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const AssetCodeSchema = Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._:-]+$" });
const MinorUnitExponentSchema = Type.Integer({ minimum: 0, maximum: 18 });
const AssetSelectorSchema = Type.Union([
	Type.Object({ assetId: AssetIdSchema, assetCode: Type.Optional(Type.Never()) }),
	Type.Object({ assetCode: AssetCodeSchema, assetId: Type.Optional(Type.Never()) }),
]);
const AssetSummarySchema = Type.Object({
	assetId: AssetIdSchema,
	assetCode: AssetCodeSchema,
	minorUnitExponent: MinorUnitExponentSchema,
});
type AssetSelector = Static<typeof AssetSelectorSchema>;
type AssetSummary = Static<typeof AssetSummarySchema>;
const normalizeAssetCode = (code: string): string => code.toUpperCase();

export {
	AssetIdSchema,
	AssetCodeSchema,
	MinorUnitExponentSchema,
	AssetSelectorSchema,
	AssetSummarySchema,
	normalizeAssetCode,
};
export type { AssetSelector, AssetSummary };
