import { encodeUuid } from "@/lib/utils";
import { TypeID } from "typeid-js";
import { describe, expect, it } from "vitest";

import type { LedgerAccountStatementRow } from "@/db/schema";
import { LedgerAccountStatement } from "./LedgerAccountStatement";

const ledgerId = "lgr_01h2x3y4z5a6b7c8d9e0f1g2h4";
const accountId = "lat_01h2x3y4z5a6b7c8d9e0f1g2h8";
const statementId = "lst_01h2x3y4z5a6b7c8d9e0f1g2h7";
const statementDate = new Date("2025-01-01T00:00:00.000Z");
const created = new Date("2025-01-02T00:00:00.000Z");
const updated = new Date("2025-01-03T00:00:00.000Z");

const asset = {
	assetId: "ast_01h2x3y4z5a6b7c8d9e0f1g2h4",
	assetCode: "AAPL",
	minorUnitExponent: 6,
};

const row = (metadata: string | null = JSON.stringify({ period: "monthly" })) =>
	({
		id: encodeUuid(TypeID.fromString(statementId)),
		ledgerId: encodeUuid(TypeID.fromString(ledgerId)),
		accountId: encodeUuid(TypeID.fromString(accountId)),
		statementDate,
		openingBalance: 9007199254740993n,
		closingBalance: -9007199254740993n,
		totalCredits: 30n,
		totalDebits: 21n,
		transactionCount: 4,
		metadata,
		created,
		updated,
	}) satisfies LedgerAccountStatementRow;

describe("LedgerAccountStatement", () => {
	it("builds the existing placeholder state from the validated request", () => {
		const statement = LedgerAccountStatement.fromRequest(
			{
				ledgerId,
				accountId,
				description: "ignored",
				startDatetime: statementDate.toISOString(),
				endDatetime: "2025-02-01T00:00:00.000Z",
			},
			asset
		);

		expect(statement.id).toBeInstanceOf(TypeID);
		expect(statement.id.getType()).toBe("lst");
		expect(statement).toMatchObject({
			ledgerId: TypeID.fromString(ledgerId),
			accountId: TypeID.fromString(accountId),
			statementDate,
			openingBalance: 0n,
			closingBalance: 0n,
			totalCredits: 0n,
			totalDebits: 0n,
			transactionCount: 0,
			metadata: undefined,
		});
		expect(statement.created).toBe(statement.updated);
	});

	it("decodes stored values and valid JSON metadata", () => {
		const statement = LedgerAccountStatement.fromRow(row(), asset);

		expect(statement).toMatchObject({
			id: TypeID.fromString(statementId),
			ledgerId: TypeID.fromString(ledgerId),
			accountId: TypeID.fromString(accountId),
			statementDate,
			openingBalance: 9007199254740993n,
			closingBalance: -9007199254740993n,
			totalCredits: 30n,
			totalDebits: 21n,
			transactionCount: 4,
			metadata: { period: "monthly" },
			created,
			updated,
		});
	});

	// oxlint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
	it.each([null, "not-json", JSON.stringify({ count: 1 })])(
		"treats %s metadata as absent",
		metadata => {
			expect(LedgerAccountStatement.fromRow(row(metadata), asset).metadata).toBeUndefined();
		}
	);

	it("encodes the existing insert representation with a fresh updated time", () => {
		const statement = LedgerAccountStatement.fromRow(row(), asset);
		const insert = statement.toRow();

		expect(insert).toMatchObject({
			id: encodeUuid(TypeID.fromString(statementId)),
			ledgerId: encodeUuid(TypeID.fromString(ledgerId)),
			accountId: encodeUuid(TypeID.fromString(accountId)),
			statementDate,
			openingBalance: 9007199254740993n,
			closingBalance: -9007199254740993n,
			totalCredits: 30n,
			totalDebits: 21n,
			transactionCount: 4,
			metadata: JSON.stringify({ period: "monthly" }),
		});
		expect(insert).not.toHaveProperty("created");
		expect(insert.updated).toBeInstanceOf(Date);
		expect(insert.updated?.getTime()).toBeGreaterThanOrEqual(Date.now() - 1_000);
	});

	it("returns real Asset metadata without placeholder balances", () => {
		const response = LedgerAccountStatement.fromRow(row(), asset).toResponse();

		expect(response).toEqual({
			id: statementId,
			ledgerId,
			accountId,
			description: undefined,
			startDatetime: statementDate.toISOString(),
			endDatetime: statementDate.toISOString(),
			ledgerAccountVersion: 0,
			normalBalance: "debit",
			...asset,
			metadata: { period: "monthly" },
			created: created.toISOString(),
			updated: updated.toISOString(),
		});
	});
});
