import { Context, Effect, Layer, Option } from "effect";
import {
	organizationListScope,
	organizationTargetAllowed,
	type OrganizationAccessDecision,
} from "./domain/OrganizationAccess";
import type { OrganizationId } from "./domain/OrganizationId";
import type {
	CreateOrganizationInput,
	Organization,
	UpdateOrganizationInput,
} from "./domain/Organization";
import { OrganizationAccessDenied, OrganizationNotFound } from "./domain/OrganizationErrors";
import { OrganizationIdGenerator, OrganizationIdGeneratorTag } from "./OrganizationIdGenerator";
import {
	OrganizationRepo,
	OrganizationRepoTag,
	type OrganizationDeleteRepositoryError,
	type OrganizationInfrastructureError,
} from "./OrganizationRepo";

interface OrganizationOperationInput {
	readonly actorId: OrganizationId;
	readonly access: OrganizationAccessDecision;
}

interface OrganizationListInput extends OrganizationOperationInput {
	readonly offset: number;
	readonly limit: number;
}

interface OrganizationTargetInput extends OrganizationOperationInput {
	readonly targetId: OrganizationId;
}

interface OrganizationCreateInput extends OrganizationOperationInput {
	readonly input: CreateOrganizationInput;
}

interface OrganizationUpdateInput extends OrganizationTargetInput {
	readonly input: UpdateOrganizationInput;
}

type OrganizationListError = OrganizationAccessDenied | OrganizationInfrastructureError;
type OrganizationGetError =
	| OrganizationAccessDenied
	| OrganizationNotFound
	| OrganizationInfrastructureError;
type OrganizationCreateError = OrganizationAccessDenied | OrganizationInfrastructureError;
type OrganizationUpdateError =
	| OrganizationAccessDenied
	| OrganizationNotFound
	| OrganizationInfrastructureError;
type OrganizationDeleteError =
	| OrganizationAccessDenied
	| OrganizationNotFound
	| OrganizationDeleteRepositoryError;

const requireAccess = (
	access: OrganizationAccessDecision,
	organizationId?: OrganizationId
): Effect.Effect<Exclude<OrganizationAccessDecision, "denied">, OrganizationAccessDenied> =>
	access === "denied"
		? Effect.fail(new OrganizationAccessDenied(organizationId))
		: Effect.succeed(access);

const requireTargetAccess = (
	access: OrganizationAccessDecision,
	actorId: OrganizationId,
	targetId: OrganizationId
): Effect.Effect<Exclude<OrganizationAccessDecision, "denied">, OrganizationAccessDenied> =>
	Effect.flatMap(requireAccess(access, targetId), permittedAccess =>
		organizationTargetAllowed(permittedAccess, actorId, targetId)
			? Effect.succeed(permittedAccess)
			: Effect.fail(new OrganizationAccessDenied(targetId))
	);

const requireFound = (
	organization: Option.Option<Organization>,
	targetId: OrganizationId
): Effect.Effect<Organization, OrganizationNotFound> =>
	Option.isSome(organization)
		? Effect.succeed(organization.value)
		: Effect.fail(new OrganizationNotFound(targetId));

class OrganizationService {
	constructor(
		private readonly repository: OrganizationRepo,
		private readonly idGenerator: OrganizationIdGenerator
	) {}

	list(input: OrganizationListInput): Effect.Effect<readonly Organization[], OrganizationListError> {
		return requireAccess(input.access).pipe(
			Effect.flatMap(access =>
				this.repository.list({
					scope: organizationListScope(access, input.actorId),
					offset: input.offset,
					limit: input.limit,
				})
			)
		);
	}

	get(input: OrganizationTargetInput): Effect.Effect<Organization, OrganizationGetError> {
		return requireTargetAccess(input.access, input.actorId, input.targetId).pipe(
			Effect.flatMap(() => this.repository.get(input.targetId)),
			Effect.flatMap(organization => requireFound(organization, input.targetId))
		);
	}

	create(input: OrganizationCreateInput): Effect.Effect<Organization, OrganizationCreateError> {
		if (input.access !== "platform") {
			return Effect.fail(new OrganizationAccessDenied());
		}

		return this.idGenerator
			.generate()
			.pipe(Effect.flatMap(id => this.repository.create({ id, ...input.input })));
	}

	update(input: OrganizationUpdateInput): Effect.Effect<Organization, OrganizationUpdateError> {
		return requireTargetAccess(input.access, input.actorId, input.targetId).pipe(
			Effect.flatMap(() => this.repository.update(input.targetId, input.input)),
			Effect.flatMap(organization => requireFound(organization, input.targetId))
		);
	}

	delete(input: OrganizationTargetInput): Effect.Effect<Organization, OrganizationDeleteError> {
		return requireTargetAccess(input.access, input.actorId, input.targetId).pipe(
			Effect.flatMap(() => this.repository.delete(input.targetId)),
			Effect.flatMap(organization => requireFound(organization, input.targetId))
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
	OrganizationCreateInput,
	OrganizationCreateError,
	OrganizationDeleteError,
	OrganizationGetError,
	OrganizationListInput,
	OrganizationListError,
	OrganizationTargetInput,
	OrganizationUpdateError,
	OrganizationUpdateInput,
};
export { OrganizationService, OrganizationServiceTag, organizationServiceLayer };
