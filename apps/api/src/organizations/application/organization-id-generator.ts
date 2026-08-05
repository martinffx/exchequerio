import { Context, type Effect } from "effect";
import type { OrganizationId } from "../domain/organization-id";

interface OrganizationIdGeneratorShape {
	readonly generate: Effect.Effect<OrganizationId>;
}

class OrganizationIdGenerator extends Context.Service<
	OrganizationIdGenerator,
	OrganizationIdGeneratorShape
>()("OrganizationIdGenerator") {}

export type { OrganizationIdGeneratorShape };
export { OrganizationIdGenerator };
