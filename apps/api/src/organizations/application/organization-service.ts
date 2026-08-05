import { Context, Effect, Layer, Option } from "effect";
import {
	organizationListScope,
	organizationTargetAllowed,
	type OrganizationAccessDecision,
} from "../domain/organization-access";
import type { OrganizationId } from "../domain/organization-id";
import type {
	CreateOrganizationInput,
	Organization,
	UpdateOrganizationInput,
} from "../domain/organization";
import { OrganizationAccessDenied, OrganizationNotFound } from "../domain/organization-errors";
import { OrganizationIdGenerator } from "./organization-id-generator";
import {
	OrganizationRepository,
	type OrganizationDeleteRepositoryError,
	type OrganizationInfrastructureError,
} from "./organization-repository";

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

interface OrganizationServiceShape {
	readonly list: (
		input: OrganizationListInput
	) => Effect.Effect<readonly Organization[], OrganizationListError>;
	readonly get: (
		input: OrganizationTargetInput
	) => Effect.Effect<Organization, OrganizationGetError>;
	readonly create: (
		input: OrganizationCreateInput
	) => Effect.Effect<Organization, OrganizationCreateError>;
	readonly update: (
		input: OrganizationUpdateInput
	) => Effect.Effect<Organization, OrganizationUpdateError>;
	readonly delete: (
		input: OrganizationTargetInput
	) => Effect.Effect<Organization, OrganizationDeleteError>;
}

class OrganizationService extends Context.Service<OrganizationService, OrganizationServiceShape>()(
	"OrganizationService"
) {}

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

const OrganizationServiceLive = Layer.effect(
	OrganizationService,
	Effect.gen(function* () {
		const repository = yield* OrganizationRepository;
		const idGenerator = yield* OrganizationIdGenerator;

		return {
			list: input =>
				Effect.gen(function* () {
					const access = yield* requireAccess(input.access);
					return yield* repository.list({
						scope: organizationListScope(access, input.actorId),
						offset: input.offset,
						limit: input.limit,
					});
				}),
			get: input =>
				Effect.gen(function* () {
					yield* requireTargetAccess(input.access, input.actorId, input.targetId);
					return yield* requireFound(yield* repository.get(input.targetId), input.targetId);
				}),
			create: input =>
				Effect.gen(function* () {
					const access = yield* requireAccess(input.access);
					if (access !== "platform") {
						return yield* Effect.fail(new OrganizationAccessDenied());
					}
					const id = yield* idGenerator.generate;
					return yield* repository.create({ id, ...input.input });
				}),
			update: input =>
				Effect.gen(function* () {
					yield* requireTargetAccess(input.access, input.actorId, input.targetId);
					return yield* requireFound(
						yield* repository.update(input.targetId, input.input),
						input.targetId
					);
				}),
			delete: input =>
				Effect.gen(function* () {
					yield* requireTargetAccess(input.access, input.actorId, input.targetId);
					return yield* requireFound(yield* repository.delete(input.targetId), input.targetId);
				}),
		} satisfies OrganizationServiceShape;
	})
);

export type {
	OrganizationCreateInput,
	OrganizationCreateError,
	OrganizationDeleteError,
	OrganizationGetError,
	OrganizationListInput,
	OrganizationListError,
	OrganizationServiceShape,
	OrganizationTargetInput,
	OrganizationUpdateError,
	OrganizationUpdateInput,
};
export { OrganizationService, OrganizationServiceLive };
