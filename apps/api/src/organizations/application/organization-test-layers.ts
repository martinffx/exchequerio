import { Effect, Layer } from "effect";
import type { OrganizationId } from "../domain/organization-id";
import { OrganizationIdGenerator } from "./organization-id-generator";
import {
	OrganizationRepository,
	type OrganizationRepositoryShape,
} from "./organization-repository";

const makeOrganizationRepositoryTest = (repository: OrganizationRepositoryShape) =>
	Layer.succeed(OrganizationRepository, repository);

const makeOrganizationIdGeneratorTest = (id: OrganizationId) =>
	Layer.succeed(OrganizationIdGenerator, { generate: Effect.succeed(id) });

export { makeOrganizationIdGeneratorTest, makeOrganizationRepositoryTest };
