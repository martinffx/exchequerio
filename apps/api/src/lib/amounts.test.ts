import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { BadRequestError, ConflictError } from "./errors";
import {
	AmountSchema,
	PositiveAmountSchema,
	INT64_MIN,
	INT64_MAX,
	parseAmount,
	assertInt64,
} from "./amounts";

describe("integer minor units", () => {
	it("decodes exact signed 64-bit quantities above the number limit", () => {
		expect(parseAmount("9007199254740993")).toBe(9007199254740993n);
		expect(parseAmount("9223372036854775807")).toBe(INT64_MAX);
		expect(parseAmount("-9223372036854775808")).toBe(INT64_MIN);
		expect(parseAmount("0")).toBe(0n);
	});
	it.each([
		"01",
		"-0",
		"+1",
		"1.0",
		"1e3",
		" 1",
		"1 ",
		"",
		"9223372036854775808",
		"-9223372036854775809",
	])("rejects invalid amount %s", value => {
		expect(() => parseAmount(value)).toThrow(BadRequestError);
	});
	it("requires strings and positive entry quantities in transport", () => {
		expect(Value.Check(AmountSchema, 100)).toBe(false);
		expect(Value.Check(AmountSchema, "-100")).toBe(true);
		expect(Value.Check(PositiveAmountSchema, "0")).toBe(false);
		expect(Value.Check(PositiveAmountSchema, "-1")).toBe(false);
		expect(Value.Check(PositiveAmountSchema, "100")).toBe(true);
	});
	it("allows exact intermediate cancellation but rejects final overflow", () => {
		expect(assertInt64(INT64_MAX + 1n - 1n)).toBe(INT64_MAX);
		expect(() => assertInt64(INT64_MAX + 1n)).toThrow(ConflictError);
		expect(() => assertInt64(INT64_MIN - 1n)).toThrow(ConflictError);
	});
});
