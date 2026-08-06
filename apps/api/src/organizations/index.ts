import { Layer } from "effect";
import { organizationIdGeneratorLayer } from "./OrganizationIdGenerator";
import { organizationRepoLayer } from "./OrganizationRepo";
import { organizationServiceLayer } from "./OrganizationService";

const organizationLayer = organizationServiceLayer.pipe(
	Layer.provide(Layer.merge(organizationRepoLayer, organizationIdGeneratorLayer))
);

export type {
	CreateOrganizationInput,
	Organization,
	OrganizationDescriptionUpdate,
	OrganizationFields,
	OrganizationUpdateInputResult,
	OrganizationUpdateRequest,
	UpdateOrganizationInput,
} from "./domain/Organization";
export {
	createOrganization,
	parseOrganizationUpdateInput,
	updateOrganization,
} from "./domain/Organization";
export type {
	OrganizationAccessCapabilities,
	OrganizationAccessDecision,
	OrganizationAccessMode,
	OrganizationListScope,
} from "./domain/OrganizationAccess";
export {
	decideOrganizationAccess,
	organizationListScope,
	organizationTargetAllowed,
} from "./domain/OrganizationAccess";
export {
	InvalidOrganizationDescriptionUpdate,
	InvalidOrganizationId,
	OrganizationAccessDenied,
	OrganizationHasDependents,
	OrganizationNotFound,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "./domain/OrganizationErrors";
export type { OrganizationId, OrganizationIdParseResult } from "./domain/OrganizationId";
export { parseOrganizationId } from "./domain/OrganizationId";
export type {
	OrganizationCreateError,
	OrganizationCreateInput,
	OrganizationDeleteError,
	OrganizationGetError,
	OrganizationListError,
	OrganizationListInput,
	OrganizationService,
	OrganizationTargetInput,
	OrganizationUpdateError,
	OrganizationUpdateInput,
} from "./OrganizationService";
export { OrganizationServiceTag } from "./OrganizationService";
export { OrganizationRoutes } from "./OrganizationRoutes";
export { registerOrganizationRateLimit } from "./OrganizationRateLimit";
export { organizationLayer };
