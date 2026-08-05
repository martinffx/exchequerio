import { Context, type Effect } from "effect";
import type { OrganizationId } from "../domain/organization-id";

interface OrganizationIdGeneratorShape {
	readonly generate: Effect.Effect<OrganizationId>;
}

class OrganizationIdGenerator extends Context.Tag("OrganizationIdGenerator")<
	OrganizationIdGenerator,
	OrganizationIdGeneratorShape
>() {}

export type { OrganizationIdGeneratorShape };
export { OrganizationIdGenerator };
