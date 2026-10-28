import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ListQuery } from "./ListQuery";
import { AssetSelectorSchema } from "./AssetSchema";
import { AmountSchema, PositiveAmountSchema } from "./amounts";
import { IdempotencyHeaders } from "./IdempotencySchema";
import { MetadataSchema, PaginationQuery } from "./schema";

const ok = <S extends Schema.Decoder<unknown>>(s: S, v: unknown) =>
	Schema.decodeUnknownExit(s)(v)._tag === "Success";

describe("shared lib schemas", () => {
	it("PaginationQuery defaults and rejects NaN/Infinity", () => {
		expect(Schema.decodeUnknownSync(PaginationQuery)({})).toEqual({ offset: 0, limit: 20 });
		expect(ok(PaginationQuery, { offset: Number.NaN })).toBe(false);
		expect(ok(PaginationQuery, { limit: Number.POSITIVE_INFINITY })).toBe(false);
	});
	it("ListQuery defaults and bounds", () => {
		expect(Schema.decodeUnknownSync(ListQuery)({})).toEqual({ offset: 0, limit: 20 });
		expect(ok(ListQuery, { offset: 10_001 })).toBe(false);
		expect(ok(ListQuery, { offset: -1 })).toBe(false);
		expect(ok(ListQuery, { limit: 0 })).toBe(false);
		expect(ok(ListQuery, { limit: 101 })).toBe(false);
		expect(ok(ListQuery, { limit: 1.5 })).toBe(false);
		expect(ok(ListQuery, { offset: 10_000, limit: 100 })).toBe(true);
	});
	it("MetadataSchema rejects non-string values", () => {
		expect(ok(MetadataSchema, { a: "b" })).toBe(true);
		expect(ok(MetadataSchema, { a: 1 })).toBe(false);
	});
	it("AssetSelector rejects both keys or neither", () => {
		const id = "ast_0abcdefghjkmnpqrstvwxyz012";
		expect(ok(AssetSelectorSchema, { assetId: id })).toBe(true);
		expect(ok(AssetSelectorSchema, { assetCode: "USD" })).toBe(true);
		expect(ok(AssetSelectorSchema, { assetId: id, assetCode: "USD" })).toBe(false);
		expect(ok(AssetSelectorSchema, {})).toBe(false);
	});
	it("Amount patterns and lengths", () => {
		expect(ok(AmountSchema, "-12")).toBe(true);
		expect(ok(AmountSchema, "007")).toBe(false);
		expect(ok(AmountSchema, "1".repeat(21))).toBe(false);
		expect(ok(PositiveAmountSchema, "0")).toBe(false);
		expect(ok(PositiveAmountSchema, "9223372036854775807")).toBe(true);
		expect(ok(PositiveAmountSchema, "1".repeat(20))).toBe(false);
	});
	it("IdempotencyHeaders length bounds", () => {
		expect(ok(IdempotencyHeaders, { "idempotency-key": "" })).toBe(false);
		expect(ok(IdempotencyHeaders, { "idempotency-key": "a".repeat(256) })).toBe(false);
		expect(ok(IdempotencyHeaders, { "idempotency-key": "a" })).toBe(true);
	});
});
