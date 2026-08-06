import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { OrganizationId } from "./OrganizationId";
import { createOrganization, parseOrganizationUpdateInput } from "./Organization";
import { InvalidOrganizationDescriptionUpdate } from "./OrganizationErrors";

const id = "org_01h2x3y4z5a6b7c8d9e0f1g2h3" as OrganizationId;
const created = DateTime.fromISO("2026-08-04T12:00:00.000+02:00", { setZone: true });

describe("Organization", () => {
	it("creates an immutable Organization with an absent description", () => {
		const organization = createOrganization({ id, name: "Example", created, updated: created });

		expect(organization.description).toBeUndefined();
		expect(Object.isFrozen(organization)).toBe(true);
		expect(organization.created.zoneName).toBe("UTC");
		expect(organization.created.toISO()).toBe("2026-08-04T10:00:00.000Z");
	});

	it.each([
		{
			case: "omission to preserve intent",
			request: { name: "After" },
			description: { _tag: "Preserve" },
		},
		{
			case: "a supplied value to replace intent",
			request: { name: "After", description: "Replacement" },
			description: { _tag: "Replace", value: "Replacement" },
		},
	])("translates $case", ({ request, description }) => {
		expect(parseOrganizationUpdateInput(request)).toEqual({
			_tag: "Success",
			value: { name: "After", description },
		});
	});

	it("rejects an explicitly present undefined description without throwing", () => {
		const request = { name: "After", description: undefined };

		expect(parseOrganizationUpdateInput(request)).toEqual({
			_tag: "Failure",
			error: new InvalidOrganizationDescriptionUpdate(),
		});
	});
});
