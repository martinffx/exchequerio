import { Schema } from "effect";

const AssetIdSchema = Schema.String.check(Schema.isPattern(/^ast_[0-7][0-9a-hjkmnp-tv-z]{25}$/));
const AssetCodeSchema = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(64),
	Schema.isPattern(/^[A-Za-z0-9._:-]+$/)
);
const MinorUnitExponentSchema = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 18 }));
const AssetSelectorSchema = Schema.Union([
	Schema.Struct({ assetId: AssetIdSchema, assetCode: Schema.optionalKey(Schema.Never) }),
	Schema.Struct({ assetCode: AssetCodeSchema, assetId: Schema.optionalKey(Schema.Never) }),
]);
const AssetSummarySchema = Schema.Struct({
	assetId: AssetIdSchema,
	assetCode: AssetCodeSchema,
	minorUnitExponent: MinorUnitExponentSchema,
});
type AssetSummary = typeof AssetSummarySchema.Type;
const normalizeAssetCode = (code: string): string => code.toUpperCase();

export {
	AssetIdSchema,
	AssetCodeSchema,
	MinorUnitExponentSchema,
	AssetSelectorSchema,
	AssetSummarySchema,
	normalizeAssetCode,
};
export type { AssetSummary };
