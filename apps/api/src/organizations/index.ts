import { Layer } from "effect";
import { organizationIdGeneratorLayer } from "./OrganizationIdGenerator";
import { organizationRepoLayer } from "./OrganizationRepo";
import { organizationServiceLayer } from "./OrganizationService";

const organizationLayer = organizationServiceLayer.pipe(
	Layer.provide(Layer.merge(organizationRepoLayer, organizationIdGeneratorLayer))
);

export { Organization } from "./domain/Organization";
export {
	OrganizationHasDependents,
	OrganizationNotFound,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "./domain/OrganizationErrors";

export type {
	OrganizationCreateError,
	OrganizationDeleteError,
	OrganizationGetError,
	OrganizationListError,
	OrganizationService,
	OrganizationUpdateError,
} from "./OrganizationService";
export { OrganizationServiceTag } from "./OrganizationService";
export { OrganizationRoutes } from "./OrganizationRoutes";
export { organizationLayer };
