import { Context, Effect, Layer, Option } from "effect";
import type { OrgID } from "@/lib/ids";
import { Organization } from "./Organization";
import { OrganizationHasDependents, OrganizationNotFound } from "./OrganizationErrors";
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

const requireFound = (): ((
	organization: Option.Option<Organization>
) => Effect.Effect<Organization, OrganizationNotFound>) =>
	Option.match({
		onNone: () => Effect.fail(new OrganizationNotFound()),
		onSome: Effect.succeed,
	});

/** Orchestrates Organization use cases and converts repository absence into typed failures. */
class OrganizationService {
	/**
	 * Creates an Organization service.
	 *
	 * @param repository - Repository used for Organization persistence.
	 * @param idGenerator - Generator used for new Organization identifiers.
	 */
	constructor(
		private readonly repository: OrganizationRepo,
		private readonly idGenerator: OrganizationIdGenerator
	) {}

	/**
	 * Lists Organizations with pagination.
	 *
	 * @param options - Offset and limit for the result page.
	 * @returns An Effect containing the requested page of Organizations.
	 */
	listOrganizations({
		offset,
		limit,
	}: ListOrganizationsOptions): Effect.Effect<Organization[], OrganizationListError> {
		return Effect.suspend(() =>
			this.repository.listOrganizations({
				offset,
				limit,
			})
		).pipe(Effect.withSpan("OrganizationService.listOrganizations"));
	}

	/**
	 * Gets an Organization and converts repository absence into `OrganizationNotFound`.
	 *
	 * @param orgId - Organization to get.
	 * @returns An Effect containing the Organization.
	 */
	getOrganization(orgId: OrgID): Effect.Effect<Organization, OrganizationGetError> {
		return Effect.suspend(() =>
			this.repository.getOrganization(orgId).pipe(Effect.flatMap(requireFound()))
		).pipe(
			Effect.withSpan("OrganizationService.getOrganization", {
				attributes: { "organization.id": String(orgId) },
			})
		);
	}

	/**
	 * Generates an identifier, builds an Organization, and persists it.
	 *
	 * @param rq - Validated Organization creation request.
	 * @returns An Effect containing the created Organization.
	 */
	createOrganization(
		rq: OrganizationCreateRequest
	): Effect.Effect<Organization, OrganizationCreateError> {
		return Effect.suspend(() =>
			this.idGenerator.generate().pipe(
				Effect.flatMap(id => {
					const organization = Organization.fromRequest(id, rq);
					return this.repository.createOrganization(organization);
				})
			)
		).pipe(Effect.withSpan("OrganizationService.createOrganization"));
	}

	/**
	 * Replaces an Organization's mutable fields and requires the Organization to exist.
	 *
	 * @param orgId - Organization to update.
	 * @param rq - Validated Organization update request.
	 * @returns An Effect containing the updated Organization.
	 */
	updateOrganization(
		orgId: OrgID,
		rq: OrganizationUpdateRequest
	): Effect.Effect<Organization, OrganizationUpdateError> {
		return Effect.suspend(() => {
			const organization = Organization.fromRequest(orgId, rq);
			return this.repository.updateOrganization(organization).pipe(Effect.flatMap(requireFound()));
		}).pipe(
			Effect.withSpan("OrganizationService.updateOrganization", {
				attributes: { "organization.id": String(orgId) },
			})
		);
	}

	/**
	 * Deletes an Organization and requires the Organization to exist.
	 *
	 * @param orgId - Organization to delete.
	 * @returns An Effect containing the deleted Organization.
	 */
	deleteOrganization(orgId: OrgID): Effect.Effect<Organization, OrganizationDeleteError> {
		return Effect.suspend(() =>
			this.repository.deleteOrganization(orgId).pipe(Effect.flatMap(requireFound()))
		).pipe(
			Effect.withSpan("OrganizationService.deleteOrganization", {
				attributes: { "organization.id": String(orgId) },
			})
		);
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
