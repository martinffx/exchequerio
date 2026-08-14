type Currency = Readonly<{
	code: string;
	minorUnitExponent: number;
}>;

const makeCurrency = (code: string, minorUnitExponent: number): Currency => {
	if (code.trim().length === 0) throw new RangeError("Currency Code must not be blank");
	if (!Number.isSafeInteger(minorUnitExponent) || minorUnitExponent < 0) {
		throw new RangeError("Minor Unit Exponent must be a nonnegative safe integer");
	}
	return Object.freeze({ code, minorUnitExponent });
};

const currencyEquals = (left: Currency, right: Currency): boolean =>
	left.code === right.code && left.minorUnitExponent === right.minorUnitExponent;

export type { Currency };
export { currencyEquals, makeCurrency };
