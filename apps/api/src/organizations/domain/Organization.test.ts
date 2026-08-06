import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { OrganizationId } from "./OrganizationId";
import {
	createOrganization,
	parseOrganizationUpdateInput,
	updateOrganization,
} from "./Organization";
import { InvalidOrganizationDescriptionUpdate } from "./OrganizationErrors";

const id = "org_01h2x3y4z5a6b7c8d9e0f1g2h3" as OrganizationId;
const created = DateTime.fromISO("2026-08-04T12:00:00.000+02:00", { setZone: true });
const updated = DateTime.fromISO("2026-08-04T11:00:00.000Z", { zone: "utc" });

describe("Organization", () => {
	it("creates an immutable Organization with an absent description", () => {
		const organization = createOrganization({ id, name: "Example", created, updated });

		expect(organization.description).toBeUndefined();
		expect(Object.isFrozen(organization)).toBe(true);
		expect(organization.created.zoneName).toBe("UTC");
		expect(organization.created.toISO()).toBe("2026-08-04T10:00:00.000Z");
	});

	it("preserves an omitted description", () => {
		const organization = createOrganization({
			id,
			name: "Before",
			description: "Keep me",
			created,
			updated: created,
		});

		const input = parseOrganizationUpdateInput({ name: "After" });
		expect(input._tag).toBe("Success");
		if (input._tag === "Failure") expect.fail("expected a valid preserve update");

		const result = updateOrganization(organization, input.value, updated);

		expect(result.description).toBe("Keep me");
		expect(result.name).toBe("After");
		expect(result.updated).toBe(updated);
	});

	it("replaces a supplied description", () => {
		const organization = createOrganization({
			id,
			name: "Before",
			description: "Before description",
			created,
			updated: created,
		});

		const input = parseOrganizationUpdateInput({
			name: "After",
			description: "After description",
		});
		expect(input._tag).toBe("Success");
		if (input._tag === "Failure") expect.fail("expected a valid replacement update");

		const result = updateOrganization(organization, input.value, updated);

		expect(result.description).toBe("After description");
		expect(result.name).toBe("After");
	});

	it("rejects an explicitly present undefined description without throwing", () => {
		const request = { name: "After", description: undefined };

		expect(parseOrganizationUpdateInput(request)).toEqual({
			_tag: "Failure",
			error: new InvalidOrganizationDescriptionUpdate(),
		});
	});
});
