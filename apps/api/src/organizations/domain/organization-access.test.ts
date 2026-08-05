import { describe, expect, it } from "vitest";
import type { OrganizationId } from "./organization-id";
import {
	decideOrganizationAccess,
	organizationListScope,
	organizationTargetAllowed,
} from "./organization-access";

const actorId = "org_01h2x3y4z5a6b7c8d9e0f1g2h3" as OrganizationId;
const otherId = "org_01h2x3y4z5a6b7c8d9e0f1g2h4" as OrganizationId;

describe("Organization access", () => {
	it("gives platform access precedence", () => {
		expect(decideOrganizationAccess({ platform: true, current: true })).toBe("platform");
	});

	it("permits platform access to any target", () => {
		expect(organizationTargetAllowed("platform", actorId, otherId)).toBe(true);
	});

	it("permits current access only to the actor Organization", () => {
		expect(organizationTargetAllowed("current", actorId, actorId)).toBe(true);
		expect(organizationTargetAllowed("current", actorId, otherId)).toBe(false);
	});

	it("turns current list access into an actor-scoped repository query", () => {
		expect(organizationListScope("current", actorId)).toEqual({
			_tag: "Organization",
			organizationId: actorId,
		});
	});
});
