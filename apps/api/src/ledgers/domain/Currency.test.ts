import { describe, expect, it } from "vitest";
import {
	currencyEquals,
	makeCurrency,
	makeCurrencyCode,
	makeMinorUnitExponent,
	makeMinorUnits,
} from "./Currency";

describe("Currency", () => {
	it("keeps opaque codes unchanged", () => {
		expect(makeCurrencyCode("US0378331005")).toBe("US0378331005");
		expect(makeCurrencyCode("usd")).toBe("usd");
	});

	it.each(["", "   "])("rejects a blank code", value => {
		expect(() => makeCurrencyCode(value)).toThrow(RangeError);
	});

	it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		"rejects an invalid Minor Unit Exponent",
		value => {
			expect(() => makeMinorUnitExponent(value)).toThrow(RangeError);
		}
	);

	it("accepts negative safe-integer Minor Units", () => {
		expect(makeMinorUnits(-101)).toBe(-101);
	});

	it.each([1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		"rejects invalid Minor Units",
		value => {
			expect(() => makeMinorUnits(value)).toThrow(RangeError);
		}
	);

	it("compares both parts of a Currency", () => {
		const usd = makeCurrency("USD", 2);

		expect(currencyEquals(usd, makeCurrency("USD", 2))).toBe(true);
		expect(currencyEquals(usd, makeCurrency("usd", 2))).toBe(false);
		expect(currencyEquals(usd, makeCurrency("USD", 0))).toBe(false);
	});
});
