import { Context, Effect, Layer } from "effect";
import { TypeID } from "typeid-js";
import type { OrgID } from "../repo/entities/types";
import { parseId } from "./domain/OrganizationId";

interface OrganizationIdGenerator {
	generate(): Effect.Effect<OrgID>;
}

const OrganizationIdGeneratorTag =
	Context.Service<OrganizationIdGenerator>("OrganizationIdGenerator");

class OrganizationIdGeneratorLive implements OrganizationIdGenerator {
	generate() {
		return parseId<"org", OrgID>("org", new TypeID("org").toString()).pipe(Effect.orDie);
	}
}

const organizationIdGeneratorLayer = Layer.succeed(
	OrganizationIdGeneratorTag,
	new OrganizationIdGeneratorLive()
);

export {
	type OrganizationIdGenerator,
	OrganizationIdGeneratorLive,
	OrganizationIdGeneratorTag,
	organizationIdGeneratorLayer,
};
