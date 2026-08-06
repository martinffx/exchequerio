import { describe, expect, it } from "vitest";
import { resolveOrganizationAccess } from "./OrganizationAuthorization";

describe("resolveOrganizationAccess", () => {
	it.each([
		["read", ["organization:read", "my:organization:read"], "platform"],
		["read", ["organization:read"], "platform"],
		["read", ["my:organization:read"], "current"],
		["read", [], "denied"],
		["create", ["organization:write", "my:organization:write"], "platform"],
		["create", ["my:organization:write"], "denied"],
		["update", ["organization:write", "my:organization:write"], "platform"],
		["update", ["my:organization:write"], "current"],
		["delete", ["my:organization:write"], "current"],
	] as const)("resolves %s access from %j", (operation, permissions, expected) => {
		expect(resolveOrganizationAccess(new Set<string>(permissions), operation)).toBe(expected);
	});
});
