import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	OrganizationIdGeneratorTag,
	organizationIdGeneratorLayer,
} from "./OrganizationIdGenerator";
import { parseOrganizationId } from "./domain/OrganizationId";

describe("OrganizationIdGeneratorLive", () => {
	it("generates canonical Organization TypeIDs", async () => {
		const id = await Effect.runPromise(
			OrganizationIdGeneratorTag.pipe(
				Effect.flatMap(generator => generator.generate()),
				Effect.provide(organizationIdGeneratorLayer)
			)
		);

		expect(parseOrganizationId(id)).toEqual({ _tag: "Success", value: id });
	});
});
