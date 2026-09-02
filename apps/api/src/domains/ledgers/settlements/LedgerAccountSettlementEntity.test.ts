import { Value } from "@sinclair/typebox/value";
import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	newLedgerAccountID,
	newLedgerAccountSettlementID,
	newLedgerID,
	newLedgerTransactionID,
	newOrgID,
} from "@/repo/entities/types";
import type { LedgerAccountSettlementRow } from "@/repo/schema";

import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import {
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
} from "./LedgerAccountSettlementSchema";

const created = new Date("2026-08-01T10:00:00.000Z");
const updated = new Date("2026-08-02T11:00:00.000Z");

const settlementRow = (
	overrides: Partial<LedgerAccountSettlementRow> = {}
): LedgerAccountSettlementRow => ({
	id: newLedgerAccountSettlementID().toString(),
	organizationId: newOrgID().toString(),
	transactionId: newLedgerTransactionID().toString(),
	settledAccountId: newLedgerAccountID().toString(),
	contraAccountId: newLedgerAccountID().toString(),
	amount: 125,
	normalBalance: "debit",
	currency: "USD",
	status: "drafting",
	description: "August settlement",
	externalReference: "external-1",
	effectiveAtUpperBound: new Date("2026-08-01T09:00:00.000Z"),
	metadata: JSON.stringify({ source: "test" }),
	created,
	updated,
	...overrides,
});

afterEach(() => {
	vi.useRealTimers();
});

describe("LedgerAccountSettlementSchema", () => {
	it("retains the current request and response contracts", () => {
		expect(LedgerAccountSettlementRequest.$id).toBe("LedgerAccountSettlementRequest");
		expect(LedgerAccountSettlementResponse.$id).toBe("LedgerAccountSettlementResponse");
		expect(LedgerAccountSettlementRequest.required).toEqual([
			"transactionId",
			"status",
			"settledAccountId",
			"contraAccountId",
		]);
		expect(LedgerAccountSettlementResponse.required).toEqual([
			"id",
			"transactionId",
			"status",
			"normalBalance",
			"settledAccountId",
			"contraAccountId",
			"amount",
			"currency",
			"created",
			"updated",
		]);
		expect(Object.keys(LedgerAccountSettlementRequest.properties)).toEqual([
			"transactionId",
			"description",
			"status",
			"settledAccountId",
			"contraAccountId",
			"effectiveAtUpperBound",
			"externalReference",
			"metadata",
		]);
		expect(Value.Check(LedgerAccountSettlementRequest, {})).toBe(false);
	});
});

describe("LedgerAccountSettlementEntity", () => {
	it("converts requests lazily and replaces creation and update times when an id is reused", () => {
		const now = new Date("2026-08-29T12:00:00.000Z");
		vi.useFakeTimers();
		vi.setSystemTime(now);
		const id = newLedgerAccountSettlementID();
		const settledAccountId = newLedgerAccountID();
		const contraAccountId = newLedgerAccountID();

		const entity = Effect.runSync(
			LedgerAccountSettlementEntity.fromRequest(
				{
					transactionId: "",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
					status: "drafting",
					effectiveAtUpperBound: "2026-08-28T12:00:00.000Z",
					metadata: { source: "request" },
				},
				newOrgID(),
				"USD",
				"credit",
				settledAccountId,
				contraAccountId,
				id
			)
		);

		expect(entity).toMatchObject({
			id,
			transactionId: undefined,
			settledAccountId,
			contraAccountId,
			amount: 0,
			normalBalance: "credit",
			currency: "USD",
			created: DateTime.fromJSDate(now, { zone: "utc" }),
			updated: DateTime.fromJSDate(now, { zone: "utc" }),
		});
		expect(entity.effectiveAtUpperBound?.toISO()).toBe("2026-08-28T12:00:00.000Z");
	});

	it("round-trips rows, metadata, nullable fields, TypeIDs, and dates", () => {
		const row = settlementRow({
			// oxlint-disable-next-line unicorn/no-null -- Drizzle returns SQL NULL.
			transactionId: null,
			// oxlint-disable-next-line unicorn/no-null -- Drizzle returns SQL NULL.
			description: null,
			// oxlint-disable-next-line unicorn/no-null -- Drizzle returns SQL NULL.
			externalReference: null,
			// oxlint-disable-next-line unicorn/no-null -- Drizzle returns SQL NULL.
			effectiveAtUpperBound: null,
		});
		const entity = Effect.runSync(LedgerAccountSettlementEntity.fromRow(row));

		expect(entity.id.toString()).toBe(row.id);
		expect(entity.organizationId.toString()).toBe(row.organizationId);
		expect(entity.transactionId).toBeUndefined();
		expect(entity.metadata).toEqual({ source: "test" });
		expect(entity.created.toJSDate()).toEqual(created);
		expect(entity.updated.toJSDate()).toEqual(updated);
		expect(entity.toRow()).toEqual({
			...row,
			transactionId: undefined,
			description: undefined,
			externalReference: undefined,
			effectiveAtUpperBound: undefined,
		});
	});

	it("rejects invalid persisted metadata", () => {
		expect(() =>
			Effect.runSync(LedgerAccountSettlementEntity.fromRow(settlementRow({ metadata: "{" })))
		).toThrow("Persisted Settlement could not be decoded");
	});

	it("omits stored-only fields and uses an empty Transaction id in responses", () => {
		const response = Effect.runSync(
			LedgerAccountSettlementEntity.fromRow(
				// oxlint-disable-next-line unicorn/no-null -- Drizzle returns SQL NULL.
				settlementRow({ transactionId: null })
			)
		).toResponse();

		expect(response.transactionId).toBe("");
		expect(response).not.toHaveProperty("externalReference");
		expect(response).not.toHaveProperty("effectiveAtUpperBound");
	});

	it("owns valid lifecycle transitions", () => {
		const settlement = Effect.runSync(LedgerAccountSettlementEntity.fromRow(settlementRow()));
		const updated = DateTime.fromISO("2026-08-30T12:00:00.000Z", { zone: "utc" });

		const transitioned = Effect.runSync(settlement.transitionTo("processing", updated));

		expect(transitioned).toEqual({ ...settlement, status: "processing", updated });
		expect(() => Effect.runSync(settlement.transitionTo("posted", updated))).toThrow(
			"Invalid Settlement status transition"
		);
	});

	it("converts a Settlement into a balanced Posted Transaction entity", () => {
		const settlement = Effect.runSync(LedgerAccountSettlementEntity.fromRow(settlementRow()));
		const transaction = Effect.runSync(settlement.toTransaction(newLedgerID(), settlement.created));
		const entries = Option.getOrThrow(transaction.entries);

		expect(transaction.status).toBe("posted");
		expect(transaction.metadata).toEqual({ source: "test", settlementId: settlement.id.toString() });
		expect(entries.map(entry => entry.direction)).toEqual(["credit", "debit"]);
		expect(entries.map(entry => entry.amount)).toEqual([settlement.amount, settlement.amount]);
	});
});
