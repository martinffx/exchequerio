import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { OrgID } from "../repo/entities/types";
import {
	OrganizationIdGeneratorTag,
	organizationIdGeneratorLayer,
} from "./OrganizationIdGenerator";
import { parseId } from "./domain/OrganizationId";

describe("OrganizationIdGeneratorLive", () => {
	it("generates canonical Organization TypeIDs", async () => {
		const id = await Effect.runPromise(
			OrganizationIdGeneratorTag.pipe(
				Effect.flatMap(generator => generator.generate()),
				Effect.provide(organizationIdGeneratorLayer)
			)
		);

		expect(await Effect.runPromise(parseId<"org", OrgID>("org", id.toString()))).toEqual(id);
	});
});
