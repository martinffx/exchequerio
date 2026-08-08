import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { OrganizationRow } from "../../repo/schema";
import { Organization } from "./Organization";
import { OrganizationPersistenceDecodingFailure } from "./OrganizationErrors";

const row = {
	id: "org_01h2x3y4z5a6b7c8d9e0f1g2h3",
	name: "Example",
	// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
	description: null,
	created: new Date("2026-08-04T10:00:00.000Z"),
	updated: new Date("2026-08-04T11:00:00.000Z"),
} satisfies OrganizationRow;

describe("Organization", () => {
	it("decodes a Drizzle row into UTC domain values", () => {
		const organization = Option.getOrThrow(Effect.runSync(Organization.fromRow(row)));

		expect(organization.description).toBeUndefined();
		expect(organization.created).toBeInstanceOf(DateTime);
		expect(organization.created.zoneName).toBe("UTC");
		expect(organization.created.toISO()).toBe("2026-08-04T10:00:00.000Z");
	});

	it("encodes a complete Drizzle row and round-trips all domain fields", () => {
		const organization = Option.getOrThrow(Effect.runSync(Organization.fromRow(row)));
		const encoded = organization.toRow();
		const decoded = Option.getOrThrow(Effect.runSync(Organization.fromRow(encoded)));

		expect(encoded).toEqual(row);
		expect(decoded.toRow()).toEqual(row);
	});

	it("returns None when no row exists", () => {
		expect(Effect.runSync(Organization.fromRow(undefined))).toEqual(Option.none());
	});

	it.each([
		{ ...row, id: "not-an-organization" },
		{ ...row, id: "lgr_01h2x3y4z5a6b7c8d9e0f1g2h3" },
		{ ...row, created: new Date("invalid") },
		{ ...row, updated: new Date("invalid") },
	])("fails with a typed error when persisted data cannot be decoded", invalidRow => {
		const error = Effect.runSync(Organization.fromRow(invalidRow).pipe(Effect.flip));

		expect(error).toBeInstanceOf(OrganizationPersistenceDecodingFailure);
	});
});
