import { describe, expect, it } from "vitest";
import { parseOrganizationId } from "./OrganizationId";

describe("parseOrganizationId", () => {
	it("accepts a canonical Organization TypeID", () => {
		const result = parseOrganizationId("org_01h2x3y4z5a6b7c8d9e0f1g2h3");

		expect(result).toEqual({
			_tag: "Success",
			value: "org_01h2x3y4z5a6b7c8d9e0f1g2h3",
		});
	});

	it.each(["not-an-id", "lgr_01h2x3y4z5a6b7c8d9e0f1g2h3"])("rejects %s without throwing", value => {
		expect(parseOrganizationId(value)).toMatchObject({
			_tag: "Failure",
			error: { _tag: "InvalidOrganizationId", value },
		});
	});
});
