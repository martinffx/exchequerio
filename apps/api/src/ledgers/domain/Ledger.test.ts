import { Effect, Option } from "effect";
import { TypeID } from "typeid-js";
import { describe, expect, it } from "vitest";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import type { LedgerRow } from "@/repo/schema";
import { LedgerPersistenceDecodingFailure } from "../LedgerErrors";
import { Ledger } from "./Ledger";

const row = {
	id: "lgr_01h2x3y4z5a6b7c8d9e0f1g2h3",
	organizationId: "org_01h2x3y4z5a6b7c8d9e0f1g2h3",
	name: "Operating Ledger",
	description: "Primary book",
	metadata: JSON.stringify({ externalId: "book-42" }),
	created: new Date("2026-08-09T10:00:00.000Z"),
	updated: new Date("2026-08-09T11:00:00.000Z"),
} satisfies LedgerRow;

describe("Ledger", () => {
	it("creates request-owned fields with canonical ownership", () => {
		const id = new TypeID("lgr") as LedgerID;
		const organizationId = new TypeID("org") as OrgID;
		const ledger = Ledger.fromRequest(id, organizationId, {
			name: "Treasury",
			metadata: { source: "erp" },
		});

		expect(ledger).toMatchObject({ id, organizationId, name: "Treasury" });
		expect(ledger.metadata).toEqual({ source: "erp" });
		expect(ledger.created).toBeInstanceOf(Date);
		expect(ledger.updated).toEqual(ledger.created);
	});

	it("round-trips a complete Drizzle row", () => {
		const ledger = Option.getOrThrow(Effect.runSync(Ledger.fromRow(row)));

		expect(ledger.metadata).toEqual({ externalId: "book-42" });
		expect(ledger.toRow()).toEqual(row);
	});

	it("returns None when no row exists", () => {
		expect(Effect.runSync(Ledger.fromRow(undefined))).toEqual(Option.none());
	});

	it.each([
		{ ...row, id: "not-a-ledger" },
		{ ...row, organizationId: "not-an-organization" },
		{ ...row, metadata: "{" },
		{ ...row, metadata: JSON.stringify({ externalId: 42 }) },
		{ ...row, created: new Date("invalid") },
		{ ...row, updated: new Date("invalid") },
	])("fails with a typed error when persisted data cannot be decoded", invalidRow => {
		const error = Effect.runSync(Ledger.fromRow(invalidRow).pipe(Effect.flip));

		expect(error).toBeInstanceOf(LedgerPersistenceDecodingFailure);
	});
});
