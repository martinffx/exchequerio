import { Context, type Effect, type Option } from "effect";
import type { OrganizationListScope } from "../domain/organization-access";
import type { OrganizationId } from "../domain/organization-id";
import type {
	Organization,
	CreateOrganizationInput,
	UpdateOrganizationInput,
} from "../domain/organization";
import type {
	OrganizationHasDependents,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "../domain/organization-errors";

type OrganizationInfrastructureError =
	| OrganizationPersistenceDecodingFailure
	| OrganizationPersistenceFailure
	| OrganizationRepositoryUnavailable;

type OrganizationDeleteRepositoryError =
	| OrganizationInfrastructureError
	| OrganizationHasDependents;

interface OrganizationListQuery {
	readonly scope: OrganizationListScope;
	readonly offset: number;
	readonly limit: number;
}

interface OrganizationCreateRecord extends CreateOrganizationInput {
	readonly id: OrganizationId;
}

interface OrganizationRepositoryShape {
	readonly list: (
		query: OrganizationListQuery
	) => Effect.Effect<readonly Organization[], OrganizationInfrastructureError>;
	readonly get: (
		id: OrganizationId
	) => Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError>;
	readonly create: (
		record: OrganizationCreateRecord
	) => Effect.Effect<Organization, OrganizationInfrastructureError>;
	readonly update: (
		id: OrganizationId,
		input: UpdateOrganizationInput
	) => Effect.Effect<Option.Option<Organization>, OrganizationInfrastructureError>;
	readonly delete: (
		id: OrganizationId
	) => Effect.Effect<Option.Option<Organization>, OrganizationDeleteRepositoryError>;
}

class OrganizationRepository extends Context.Tag("OrganizationRepository")<
	OrganizationRepository,
	OrganizationRepositoryShape
>() {}

export type {
	OrganizationCreateRecord,
	OrganizationDeleteRepositoryError,
	OrganizationInfrastructureError,
	OrganizationListQuery,
	OrganizationRepositoryShape,
};
export { OrganizationRepository };
