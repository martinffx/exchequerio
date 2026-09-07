import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { newOrgID, newLedgerID, newLedgerAccountID } from "@/lib/ids";
import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";

const now = DateTime.utc();
const draft = () =>
	Effect.runSync(
		LedgerAccountSettlementEntity.fromRequest(
			newOrgID(),
			newLedgerID(),
			{
				settledAccountId: newLedgerAccountID().toString(),
				contraAccountId: newLedgerAccountID().toString(),
				status: "drafting",
				allowEitherDirection: true,
			},
			{ assetId: "ast_00000000000000000000000001", assetCode: "USD", minorUnitExponent: 2 },
			now
		)
	);

describe("Settlement exact netting", () => {
	it("retains amounts above Number safe range and serializes strings", () => {
		const entity = draft();
		const transaction = Effect.runSync(
			entity.toTransaction(
				[{ amount: 9007199254740993n, direction: "debit" }],
				"debit",
				"pending",
				now
			)
		);
		expect(Option.getOrThrow(transaction.entries)[0].amount).toBe(9007199254740993n);
		expect(
			new LedgerAccountSettlementEntity({ ...entity.data, transaction }).toResponse()
		).toMatchObject({ amount: "9007199254740993", assetCode: "USD", minorUnitExponent: 2 });
	});
	it("allows intermediate totals beyond int64 when the final net fits", () => {
		const max = 9223372036854775807n;
		const transaction = Effect.runSync(
			draft().toTransaction(
				[
					{ amount: max, direction: "debit" },
					{ amount: max, direction: "debit" },
					{ amount: max, direction: "credit" },
				],
				"debit",
				"pending",
				now
			)
		);
		expect(Option.getOrThrow(transaction.entries)[0].amount).toBe(max);
	});
	it.each([9223372036854775808n, -9223372036854775808n])(
		"rejects unrepresentable positive offset magnitude %s",
		async net => {
			await expect(
				Effect.runPromise(
					draft().toTransaction(
						[
							{ amount: 9223372036854775807n, direction: net < 0n ? "credit" : "debit" },
							{ amount: 1n, direction: net < 0n ? "credit" : "debit" },
						],
						"debit",
						"pending",
						now
					)
				)
			).rejects.toMatchObject({ statusCode: 409 });
		}
	);
});
