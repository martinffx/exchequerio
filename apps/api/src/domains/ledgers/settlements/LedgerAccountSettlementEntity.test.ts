import { Value } from "@sinclair/typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	newLedgerAccountID,
	newLedgerAccountSettlementID,
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

		const entity = LedgerAccountSettlementEntity.fromRequest(
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
			id.toString()
		);

		expect(entity).toMatchObject({
			id,
			transactionId: undefined,
			settledAccountId,
			contraAccountId,
			amount: 0,
			normalBalance: "credit",
			currency: "USD",
			created: now,
			updated: now,
		});
		expect(entity.effectiveAtUpperBound).toEqual(new Date("2026-08-28T12:00:00.000Z"));
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
		const entity = LedgerAccountSettlementEntity.fromRow(row);

		expect(entity.id.toString()).toBe(row.id);
		expect(entity.organizationId.toString()).toBe(row.organizationId);
		expect(entity.transactionId).toBeUndefined();
		expect(entity.metadata).toEqual({ source: "test" });
		expect(entity.created).toBe(created);
		expect(entity.updated).toBe(updated);
		expect(entity.toRow()).toEqual({
			...row,
			transactionId: undefined,
			description: undefined,
			externalReference: undefined,
			effectiveAtUpperBound: undefined,
		});
	});

	it("retains invalid metadata as absent", () => {
		expect(LedgerAccountSettlementEntity.fromRow(settlementRow({ metadata: "{" })).metadata).toBe(
			undefined
		);
	});

	it("omits stored-only fields and uses an empty Transaction id in responses", () => {
		const response = LedgerAccountSettlementEntity.fromRow(
			// oxlint-disable-next-line unicorn/no-null -- Drizzle returns SQL NULL.
			settlementRow({ transactionId: null })
		).toResponse();

		expect(response.transactionId).toBe("");
		expect(response).not.toHaveProperty("externalReference");
		expect(response).not.toHaveProperty("effectiveAtUpperBound");
	});

	it.each([
		[
			"Amount",
			(entity: LedgerAccountSettlementEntity) => ({
				changed: entity.withAmount(300),
				expected: { amount: 300 },
			}),
		],
		[
			"Status",
			(entity: LedgerAccountSettlementEntity) => ({
				changed: entity.withStatus("processing"),
				expected: { status: "processing" },
			}),
		],
		[
			"Transaction ID",
			(entity: LedgerAccountSettlementEntity) => {
				const transactionId = newLedgerTransactionID();
				return {
					changed: entity.withTransactionId(transactionId),
					expected: { transactionId },
				};
			},
		],
	] as const)(
		"updates %s and the Updated Time while preserving every other field",
		(_name, update) => {
			const entity = LedgerAccountSettlementEntity.fromRow(settlementRow());
			const nextTime = new Date("2026-08-30T12:00:00.000Z");
			vi.useFakeTimers();
			vi.setSystemTime(nextTime);

			const { changed, expected } = update(entity);

			expect(changed).toEqual({ ...entity, ...expected, updated: nextTime });
		}
	);
});
