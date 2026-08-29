import { TypeID } from "typeid-js";
import { describe, expect, it } from "vitest";

import type { LedgerAccountStatementRow } from "@/repo/schema";

import { LedgerAccountStatement } from "./LedgerAccountStatement";

const ledgerId = "lgr_01h2x3y4z5a6b7c8d9e0f1g2h4";
const accountId = "lat_01h2x3y4z5a6b7c8d9e0f1g2h8";
const statementId = "lst_01h2x3y4z5a6b7c8d9e0f1g2h7";
const statementDate = new Date("2025-01-01T00:00:00.000Z");
const created = new Date("2025-01-02T00:00:00.000Z");
const updated = new Date("2025-01-03T00:00:00.000Z");

const row = (metadata: string | null = JSON.stringify({ period: "monthly" })) =>
	({
		id: statementId,
		ledgerId,
		accountId,
		statementDate,
		openingBalance: "10.5000",
		closingBalance: "20.2500",
		totalCredits: "30.7500",
		totalDebits: "21.0000",
		transactionCount: 4,
		metadata,
		created,
		updated,
	}) satisfies LedgerAccountStatementRow;

describe("LedgerAccountStatement", () => {
	it("builds the existing placeholder state from the validated request", () => {
		const statement = LedgerAccountStatement.fromRequest({
			ledgerId,
			accountId,
			description: "ignored",
			startDatetime: statementDate.toISOString(),
			endDatetime: "2025-02-01T00:00:00.000Z",
		});

		expect(statement.id).toBeInstanceOf(TypeID);
		expect(statement.id.getType()).toBe("lst");
		expect(statement).toMatchObject({
			ledgerId: TypeID.fromString(ledgerId),
			accountId: TypeID.fromString(accountId),
			statementDate,
			openingBalance: 0,
			closingBalance: 0,
			totalCredits: 0,
			totalDebits: 0,
			transactionCount: 0,
			metadata: undefined,
		});
		expect(statement.created).toBe(statement.updated);
	});

	it("decodes stored values and valid JSON metadata", () => {
		const statement = LedgerAccountStatement.fromRow(row());

		expect(statement).toMatchObject({
			id: TypeID.fromString(statementId),
			ledgerId: TypeID.fromString(ledgerId),
			accountId: TypeID.fromString(accountId),
			statementDate,
			openingBalance: 10.5,
			closingBalance: 20.25,
			totalCredits: 30.75,
			totalDebits: 21,
			transactionCount: 4,
			metadata: { period: "monthly" },
			created,
			updated,
		});
	});

	// oxlint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
	it.each([null, "not-json"])("treats %s metadata as absent", metadata => {
		expect(LedgerAccountStatement.fromRow(row(metadata)).metadata).toBeUndefined();
	});

	it("encodes the existing insert representation with a fresh updated time", () => {
		const statement = LedgerAccountStatement.fromRow(row());
		const insert = statement.toRow();

		expect(insert).toMatchObject({
			id: statementId,
			ledgerId,
			accountId,
			statementDate,
			openingBalance: "10.5",
			closingBalance: "20.25",
			totalCredits: "30.75",
			totalDebits: "21",
			transactionCount: 4,
			metadata: JSON.stringify({ period: "monthly" }),
		});
		expect(insert).not.toHaveProperty("created");
		expect(insert.updated).toBeInstanceOf(Date);
		expect(insert.updated?.getTime()).toBeGreaterThanOrEqual(Date.now() - 1_000);
	});

	it("returns the complete existing placeholder response", () => {
		const response = LedgerAccountStatement.fromRow(row()).toResponse();
		const balances = [
			{
				balanceType: "pending",
				amount: 0,
				currency: "USD",
				currencyExponent: 2,
				credits: 0,
				debits: 0,
			},
			{
				balanceType: "posted",
				amount: 0,
				currency: "USD",
				currencyExponent: 2,
				credits: 0,
				debits: 0,
			},
			{
				balanceType: "availableBalance",
				amount: 0,
				currency: "USD",
				currencyExponent: 2,
				credits: 0,
				debits: 0,
			},
		];

		expect(response).toEqual({
			id: statementId,
			ledgerId,
			accountId,
			description: undefined,
			startDatetime: statementDate.toISOString(),
			endDatetime: statementDate.toISOString(),
			ledgerAccountVersion: 0,
			normalBalance: "debit",
			startingBalances: balances,
			endingBalances: balances,
			currency: "USD",
			currencyExponent: 2,
			metadata: { period: "monthly" },
			created: created.toISOString(),
			updated: updated.toISOString(),
		});
	});
});
