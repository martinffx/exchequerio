import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
	OrganizationCreateRequest,
	OrganizationIdParameters,
	OrganizationListQuery,
	OrganizationUpdateRequest,
} from "./OrganizationSchema";

describe("OrganizationSchema", () => {
	it.each([
		[{ offset: 0, limit: 1 }, true],
		[{ offset: 10, limit: 100 }, true],
		[{ offset: -1, limit: 20 }, false],
		[{ offset: 0.5, limit: 20 }, false],
		[{ offset: 0, limit: 0 }, false],
		[{ offset: 0, limit: 101 }, false],
	] as const)("validates list query %j", (query, expected) => {
		expect(Value.Check(OrganizationListQuery, query)).toBe(expected);
	});

	it("requires canonical Organization parameter syntax", () => {
		expect(
			Value.Check(OrganizationIdParameters, {
				orgId: "org_01h2x3y4z5a6b7c8d9e0f1g2h3",
			})
		).toBe(true);
		expect(Value.Check(OrganizationIdParameters, { orgId: "lgr_01h2x3y4z5a6b7c8d9e0f1g2h3" })).toBe(
			false
		);
	});

	it("keeps create and update bodies explicit", () => {
		expect(Value.Check(OrganizationCreateRequest, { name: "Example" })).toBe(true);
		expect(Value.Check(OrganizationUpdateRequest, { name: "Example", description: "Text" })).toBe(
			true
		);
		expect(Value.Check(OrganizationCreateRequest, {})).toBe(false);
		expect(Value.Check(OrganizationUpdateRequest, { name: "Example", extra: true })).toBe(false);
	});
});
