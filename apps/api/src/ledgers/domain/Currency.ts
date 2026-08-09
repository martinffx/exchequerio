declare const currencyCodeBrand: unique symbol;
declare const minorUnitExponentBrand: unique symbol;
declare const minorUnitsBrand: unique symbol;

type CurrencyCode = string & { readonly [currencyCodeBrand]: "CurrencyCode" };
type MinorUnitExponent = number & {
	readonly [minorUnitExponentBrand]: "MinorUnitExponent";
};
type MinorUnits = number & { readonly [minorUnitsBrand]: "MinorUnits" };
type NormalBalance = "debit" | "credit";

type Currency = Readonly<{
	code: CurrencyCode;
	minorUnitExponent: MinorUnitExponent;
}>;

const makeCurrencyCode = (value: string): CurrencyCode => {
	if (value.trim().length === 0) throw new RangeError("Currency Code must not be blank");
	return value as CurrencyCode;
};

const makeMinorUnitExponent = (value: number): MinorUnitExponent => {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError("Minor Unit Exponent must be a nonnegative safe integer");
	}
	return value as MinorUnitExponent;
};

const makeMinorUnits = (value: number): MinorUnits => {
	if (!Number.isSafeInteger(value)) throw new RangeError("Minor Units must be a safe integer");
	return value as MinorUnits;
};

const makeCurrency = (code: string, minorUnitExponent: number): Currency =>
	Object.freeze({
		code: makeCurrencyCode(code),
		minorUnitExponent: makeMinorUnitExponent(minorUnitExponent),
	});

const currencyEquals = (left: Currency, right: Currency): boolean =>
	left.code === right.code && left.minorUnitExponent === right.minorUnitExponent;

export type { Currency, CurrencyCode, MinorUnitExponent, MinorUnits, NormalBalance };
export { currencyEquals, makeCurrency, makeCurrencyCode, makeMinorUnitExponent, makeMinorUnits };
