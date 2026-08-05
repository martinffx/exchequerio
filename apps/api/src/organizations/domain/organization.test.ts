import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { OrganizationId } from "./organization-id";
import {
	createOrganization,
	parseOrganizationUpdateInput,
	updateOrganization,
} from "./organization";
import { InvalidOrganizationDescriptionUpdate } from "./organization-errors";

const id = "org_01h2x3y4z5a6b7c8d9e0f1g2h3" as OrganizationId;
const created = DateTime.fromISO("2026-08-04T10:00:00.000Z", { zone: "utc" });
const updated = DateTime.fromISO("2026-08-04T11:00:00.000Z", { zone: "utc" });

describe("Organization", () => {
	it("creates an immutable Organization with an absent description", () => {
		const organization = createOrganization({ id, name: "Example", created, updated });
		const changed = organization.created.plus({ days: 1 });

		expect(organization.description).toBeUndefined();
		expect(Object.isFrozen(organization)).toBe(true);
		expect(organization.created.toISO()).toBe("2026-08-04T10:00:00.000Z");
		expect(changed.toISO()).toBe("2026-08-05T10:00:00.000Z");
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
	});

	it("rejects an explicitly present undefined description without throwing", () => {
		const request = { name: "After", description: undefined };

		expect(() => parseOrganizationUpdateInput(request)).not.toThrow();
		expect(parseOrganizationUpdateInput(request)).toEqual({
			_tag: "Failure",
			error: new InvalidOrganizationDescriptionUpdate(),
		});
	});
});
