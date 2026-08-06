import { Context, Effect, Layer } from "effect";
import { TypeID } from "typeid-js";
import type { OrganizationId } from "./domain/OrganizationId";
import { parseOrganizationId } from "./domain/OrganizationId";

abstract class OrganizationIdGenerator {
	abstract generate(): Effect.Effect<OrganizationId>;
}

const OrganizationIdGeneratorTag =
	Context.Service<OrganizationIdGenerator>("OrganizationIdGenerator");

class OrganizationIdGeneratorLive extends OrganizationIdGenerator {
	generate() {
		return Effect.sync(() => {
			const parsed = parseOrganizationId(new TypeID("org").toString());
			if (parsed._tag === "Failure") {
				throw new Error("TypeID generated an invalid Organization ID");
			}
			return parsed.value;
		});
	}
}

const organizationIdGeneratorLayer = Layer.succeed(
	OrganizationIdGeneratorTag,
	new OrganizationIdGeneratorLive()
);

export {
	OrganizationIdGenerator,
	OrganizationIdGeneratorLive,
	OrganizationIdGeneratorTag,
	organizationIdGeneratorLayer,
};
