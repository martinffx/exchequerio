import { Context, Effect, Layer, Option } from "effect";
import type { OrgID } from "../repo/entities/types";
import { Organization } from "./domain/Organization";
import { OrganizationHasDependents, OrganizationNotFound } from "./domain/OrganizationErrors";
import {
	OrganizationIdGeneratorTag,
	type OrganizationIdGenerator,
} from "./OrganizationIdGenerator";
import {
	type OrganizationRepo,
	OrganizationRepoTag,
	type OrganizationInfrastructureError,
} from "./OrganizationRepo";
import type { OrganizationCreateRequest, OrganizationUpdateRequest } from "./OrganizationSchema";

type ListOrganizationsOptions = {
	offset: number;
	limit: number;
};

type OrganizationServiceInfrastructureError = OrganizationInfrastructureError;
type OrganizationListError = OrganizationServiceInfrastructureError;
type OrganizationGetError = OrganizationNotFound | OrganizationServiceInfrastructureError;
type OrganizationCreateError = OrganizationServiceInfrastructureError;
type OrganizationUpdateError = OrganizationNotFound | OrganizationServiceInfrastructureError;
type OrganizationDeleteError =
	| OrganizationHasDependents
	| OrganizationNotFound
	| OrganizationServiceInfrastructureError;

const requireFound = (
	organizationId: OrgID
): ((
	organization: Option.Option<Organization>
) => Effect.Effect<Organization, OrganizationNotFound>) =>
	Option.match({
		onNone: () => Effect.fail(new OrganizationNotFound(organizationId.toString())),
		onSome: Effect.succeed,
	});

class OrganizationService {
	constructor(
		private readonly repository: OrganizationRepo,
		private readonly idGenerator: OrganizationIdGenerator
	) {}

	listOrganizations({
		offset,
		limit,
	}: ListOrganizationsOptions): Effect.Effect<Organization[], OrganizationListError> {
		return this.repository.listOrganizations({
			offset,
			limit,
		});
	}

	getOrganization(orgId: OrgID): Effect.Effect<Organization, OrganizationGetError> {
		return this.repository.getOrganization(orgId).pipe(Effect.flatMap(requireFound(orgId)));
	}

	createOrganization(
		rq: OrganizationCreateRequest
	): Effect.Effect<Organization, OrganizationCreateError> {
		return this.idGenerator.generate().pipe(
			Effect.flatMap(id => {
				const organization = Organization.fromRequest(id, rq);
				return this.repository.createOrganization(organization);
			})
		);
	}

	updateOrganization(
		orgId: OrgID,
		rq: OrganizationUpdateRequest
	): Effect.Effect<Organization, OrganizationUpdateError> {
		const organization = Organization.fromRequest(orgId, rq);
		return this.repository.updateOrganization(organization).pipe(Effect.flatMap(requireFound(orgId)));
	}

	deleteOrganization(orgId: OrgID): Effect.Effect<Organization, OrganizationDeleteError> {
		return this.repository.deleteOrganization(orgId).pipe(Effect.flatMap(requireFound(orgId)));
	}
}

const OrganizationServiceTag = Context.Service<OrganizationService>("OrganizationService");

const organizationServiceLayer = Layer.effect(
	OrganizationServiceTag,
	Effect.gen(function* () {
		return new OrganizationService(yield* OrganizationRepoTag, yield* OrganizationIdGeneratorTag);
	})
);

export type {
	OrganizationCreateError,
	OrganizationDeleteError,
	OrganizationGetError,
	OrganizationListError,
	OrganizationUpdateError,
};
export { OrganizationService, OrganizationServiceTag, organizationServiceLayer };
