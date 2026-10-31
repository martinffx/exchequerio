import { Schema } from "effect";
import { BadRequestError, ConflictError } from "./errors";

const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;
const amountPattern = "^(0|-?[1-9][0-9]*)$";
const AmountSchema = Schema.String.check(
	Schema.isPattern(new RegExp(amountPattern)),
	Schema.isMaxLength(20)
).annotate({ description: "Signed 64-bit integer minor units, encoded as a decimal string." });
const PositiveAmountSchema = Schema.String.check(
	Schema.isPattern(/^[1-9][0-9]*$/),
	Schema.isMaxLength(19)
).annotate({
	description:
		"Positive integer minor units, at most 9223372036854775807, encoded as a decimal string.",
});

function parseAmount(value: string): bigint {
	if (!new RegExp(amountPattern).test(value) || value.length > 20) {
		throw new BadRequestError("Amount must be a canonical decimal integer string");
	}
	const amount = BigInt(value);
	if (amount < INT64_MIN || amount > INT64_MAX) {
		throw new BadRequestError("Amount exceeds the signed 64-bit range");
	}
	return amount;
}

/** Check final stored projections, after exact intermediate arithmetic has completed. */
function assertInt64(value: bigint): bigint {
	if (value < INT64_MIN || value > INT64_MAX) {
		throw new ConflictError("Accounting projection exceeds the signed 64-bit range", {
			retryable: false,
		});
	}
	return value;
}

export { AmountSchema, PositiveAmountSchema, INT64_MIN, INT64_MAX, parseAmount, assertInt64 };
