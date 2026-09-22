import { Effect } from "effect";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { newLedgerAccountID, newLedgerID, newLedgerTransactionID, newOrgID } from "@/lib/ids";
import { LedgerTransaction } from "./LedgerTransaction";
import { TransactionValidationFailure } from "./LedgerTransactionErrors";
import type { ResolvedTransactionCreateRequest } from "./LedgerTransactionSchema";

const created = DateTime.fromISO("2026-09-01T12:00:00Z");
const request: ResolvedTransactionCreateRequest = {
	status: "pending",
	ledgerEntries: [
		{
			accountId: newLedgerAccountID().toString(),
			direction: "debit",
			amount: "100",
			assetId: "ast_00000000000000000000000001",
			assetCode: "EUR",
			minorUnitExponent: 2,
		},
		{
			accountId: newLedgerAccountID().toString(),
			direction: "credit",
			amount: "100",
			assetId: "ast_00000000000000000000000001",
			assetCode: "EUR",
			minorUnitExponent: 2,
		},
	],
};
const create = (overrides: Partial<ResolvedTransactionCreateRequest> = {}) =>
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
	it("keeps malformed input dates in the typed validation channel", () => {
		const input = { ...request, effectiveAt: "not-a-timestamp" };
		const creation = LedgerTransaction.fromCreateRequest(
			newLedgerTransactionID(),
			newOrgID(),
			newLedgerID(),
			input,
			created
		);
		const replacement = create().fromUpdateRequest(input, created);
		for (const effect of [creation, replacement]) {
			expect(Effect.runSync(Effect.flip(effect))).toBeInstanceOf(TransactionValidationFailure);
		}
	});

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
				// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns decode from null.
				settlementId: null,
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

it("preserves exact entry amounts above the safe integer limit and balances by Asset identity", () => {
	const transaction = create({
		ledgerEntries: request.ledgerEntries.map(entry => ({ ...entry, amount: "9007199254740993" })),
	});
	expect(transaction.toResponse().ledgerEntries.map(entry => entry.amount)).toEqual([
		"9007199254740993",
		"9007199254740993",
	]);
	expect(() =>
		create({
			ledgerEntries: request.ledgerEntries.map((entry, index) => ({
				...entry,
				assetId: `ast_0000000000000000000000000${index + 1}`,
			})),
		})
	).toThrow("balance by Asset");
});

it("balances exact intermediate totals larger than int64 across distinct Accounts", () => {
	const entries = request.ledgerEntries
		.flatMap(entry => [entry, { ...entry, accountId: newLedgerAccountID().toString() }])
		.map(entry => ({ ...entry, amount: "9223372036854775807" }));
	expect(create({ ledgerEntries: entries }).toResponse().ledgerEntries).toHaveLength(4);
});
