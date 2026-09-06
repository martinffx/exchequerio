import { Effect } from "effect";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
	newLedgerAccountID,
	newLedgerID,
	newLedgerTransactionID,
	newOrgID,
} from "@/repo/entities/types";
import { LedgerTransaction } from "./LedgerTransaction";
import type { TransactionCreateRequest } from "./LedgerTransactionSchema";

const created = DateTime.fromISO("2026-09-01T12:00:00Z");
const request: TransactionCreateRequest = {
	status: "pending",
	ledgerEntries: [
		{
			accountId: newLedgerAccountID().toString(),
			direction: "debit",
			amount: 100,
			currencyCode: "EUR",
		},
		{
			accountId: newLedgerAccountID().toString(),
			direction: "credit",
			amount: 100,
			currencyCode: "EUR",
		},
	],
};
const create = (overrides: Partial<TransactionCreateRequest> = {}) =>
	Effect.runSync(
		LedgerTransaction.fromCreateRequest(
			newLedgerTransactionID(),
			newOrgID(),
			newLedgerID(),
			{ ...request, ...overrides },
			created
		)
	);

describe("Transaction effective time", () => {
	it("defaults to server creation time and persists and returns it", () => {
		const transaction = create();
		expect(transaction.effectiveAt.toMillis()).toBe(created.toMillis());
		expect(transaction.toRow().effectiveAt).toEqual(created.toJSDate());
		expect(transaction.toResponse().effectiveAt).toBe(created.toISO());
		expect(transaction.toListItemResponse().effectiveAt).toBe(created.toISO());
	});
	it("preserves omitted effective time on update and posting", () => {
		const effectiveAt = "2026-08-01T09:00:00.000Z";
		const transaction = create({ effectiveAt });
		const updated = Effect.runSync(transaction.fromUpdateRequest(request, created.plus({ days: 1 })));
		const posted = Effect.runSync(updated.toPosted(created.plus({ days: 2 })));
		expect(posted.effectiveAt.toISO()).toBe(effectiveAt);
		expect(posted.created.toMillis()).toBe(created.toMillis());
		expect(posted.postedAt?.toMillis()).toBe(created.plus({ days: 2 }).toMillis());
	});
	it("allows a pending update to replace effective time, including future dates", () => {
		const effectiveAt = "2027-01-01T00:00:00.000Z";
		const updated = Effect.runSync(create().fromUpdateRequest({ ...request, effectiveAt }));
		expect(updated.toResponse().effectiveAt).toBe(effectiveAt);
		const decoded = Effect.runSync(
			LedgerTransaction.fromRow({
				...updated.toRow(),
				created: updated.created.toJSDate(),
				updated: updated.updated.toJSDate(),
				status: updated.status,
				lockVersion: updated.lockVersion,
				// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns decode from null.
				description: null,
				// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns decode from null.
				metadata: null,
				// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns decode from null.
				postedAt: null,
			})
		);
		expect(decoded.effectiveAt.toMillis()).toBe(updated.effectiveAt.toMillis());
	});
});
