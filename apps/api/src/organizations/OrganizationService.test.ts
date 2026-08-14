import { Effect, Layer, Option } from "effect";
import { TypeID } from "typeid-js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { HttpError, InternalServerError, ServiceUnavailableError } from "@/lib/errors";
import type { OrgID } from "../repo/entities/types";
import { Organization } from "./domain/Organization";
import {
	OrganizationHasDependents,
	OrganizationNotFound,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "./domain/OrganizationErrors";
import type { OrganizationInfrastructureError, OrganizationRepo } from "./OrganizationRepo";
import { OrganizationRepoTag } from "./OrganizationRepo";
import type { OrganizationIdGenerator } from "./OrganizationIdGenerator";
import { OrganizationIdGeneratorTag } from "./OrganizationIdGenerator";
import {
	OrganizationService,
	OrganizationServiceTag,
	organizationServiceLayer,
	type OrganizationCreateError,
	type OrganizationDeleteError,
	type OrganizationGetError,
	type OrganizationListError,
	type OrganizationUpdateError,
} from "./OrganizationService";

const targetId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h4") as OrgID;
const generatedId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h5") as OrgID;
const organization = Organization.fromRequest(targetId, {
	name: "Example",
	description: "Description",
});
const someOrganization = Option.fromNullishOr(organization);

const repository = (overrides: Partial<OrganizationRepo> = {}): OrganizationRepo =>
	vi.mocked<OrganizationRepo>({
		listOrganizations: vi.fn(() => Effect.succeed([organization])),
		getOrganization: vi.fn(() => Effect.succeed(someOrganization)),
		createOrganization: vi.fn(record => Effect.succeed(record)),
		updateOrganization: vi.fn(() => Effect.succeed(someOrganization)),
		deleteOrganization: vi.fn(() => Effect.succeed(someOrganization)),
		...overrides,
	});

const runService = <A, E>(
	repositoryImplementation: OrganizationRepo,
	use: (service: OrganizationService) => Effect.Effect<A, E>
) => {
	const idGenerator = vi.mocked<OrganizationIdGenerator>({
		generate: vi.fn(() => Effect.succeed(generatedId)),
	});
	const dependencies = Layer.merge(
		Layer.succeed(OrganizationRepoTag, repositoryImplementation),
		Layer.succeed(OrganizationIdGeneratorTag, idGenerator)
	);
	return Effect.runPromise(
		Effect.gen(function* () {
			return yield* use(yield* OrganizationServiceTag);
		}).pipe(Effect.provide(organizationServiceLayer.pipe(Layer.provide(dependencies))))
	);
};

type Operation = "list" | "get" | "create" | "update" | "delete";

const failingRepository = (
	operation: Operation,
	failure: OrganizationInfrastructureError
): OrganizationRepo => {
	switch (operation) {
		case "list":
			return repository({ listOrganizations: vi.fn(() => Effect.fail(failure)) });
		case "get":
			return repository({ getOrganization: vi.fn(() => Effect.fail(failure)) });
		case "create":
			return repository({ createOrganization: vi.fn(() => Effect.fail(failure)) });
		case "update":
			return repository({ updateOrganization: vi.fn(() => Effect.fail(failure)) });
		case "delete":
			return repository({ deleteOrganization: vi.fn(() => Effect.fail(failure)) });
	}
};

const invoke = (
	service: OrganizationService,
	operation: Operation
): Effect.Effect<unknown, HttpError> => {
	switch (operation) {
		case "list":
			return service.listOrganizations({ offset: 0, limit: 20 });
		case "get":
			return service.getOrganization(targetId);
		case "create":
			return service.createOrganization({ name: "Created" });
		case "update":
			return service.updateOrganization(targetId, { name: "Updated" });
		case "delete":
			return service.deleteOrganization(targetId);
	}
};

describe("OrganizationService", () => {
	it("forwards list pagination to the repository", async () => {
		const repo = repository();

		const result = await runService(repo, service =>
			service.listOrganizations({ offset: 10, limit: 5 })
		);

		expect(result).toEqual([organization]);
		expect(repo.listOrganizations).toHaveBeenCalledWith({ offset: 10, limit: 5 });
	});

	it("returns an existing Organization", async () => {
		const repo = repository();

		const result = await runService(repo, service => service.getOrganization(targetId));

		expect(result).toBe(organization);
		expect(repo.getOrganization).toHaveBeenCalledWith(targetId);
	});

	it.each(["get", "update", "delete"] as const)(
		"maps missing %s results to OrganizationNotFound",
		async operation => {
			const repo = repository(
				operation === "get"
					? { getOrganization: vi.fn(() => Effect.succeed(Option.none())) }
					: operation === "update"
						? { updateOrganization: vi.fn(() => Effect.succeed(Option.none())) }
						: { deleteOrganization: vi.fn(() => Effect.succeed(Option.none())) }
			);

			const error = await runService(repo, service => Effect.flip(invoke(service, operation)));

			expect(error).toEqual(new OrganizationNotFound(targetId.toString()));
		}
	);

	it.each([
		{
			operation: "create" as const,
			request: { name: "Created", description: "Description" },
			expectedId: generatedId,
		},
		{
			operation: "update" as const,
			request: { name: "Updated" },
			expectedId: targetId,
		},
	])("maps $operation requests to Organization domain values", async testCase => {
		const repo = repository({
			createOrganization: vi.fn(record => Effect.succeed(record)),
			updateOrganization: vi.fn(record => Effect.succeed(Option.fromNullishOr(record))),
		});

		const result = await runService(repo, service =>
			testCase.operation === "create"
				? service.createOrganization(testCase.request)
				: service.updateOrganization(targetId, testCase.request)
		);

		expect(result).toMatchObject({
			id: testCase.expectedId,
			name: testCase.request.name,
			description: testCase.request.description,
		});
		expect(
			testCase.operation === "create" ? repo.createOrganization : repo.updateOrganization
		).toHaveBeenCalledWith(result);
	});

	it.each(["list", "get", "create", "update", "delete"] as const)(
		"preserves repository unavailability from %s",
		async operation => {
			const failure = new OrganizationRepositoryUnavailable(new Error("unavailable"));
			const error = await runService(failingRepository(operation, failure), service =>
				Effect.flip(invoke(service, operation))
			);

			expect(error).toBe(failure);
			expect(error).toBeInstanceOf(ServiceUnavailableError);
		}
	);

	it.each(["list", "get", "create", "update", "delete"] as const)(
		"preserves persistence failures from %s",
		async operation => {
			const failure =
				operation === "get"
					? new OrganizationPersistenceDecodingFailure(new Error("invalid row"))
					: new OrganizationPersistenceFailure(new Error("query failed"));
			const error = await runService(failingRepository(operation, failure), service =>
				Effect.flip(invoke(service, operation))
			);

			expect(error).toBe(failure);
			expect(error).toBeInstanceOf(InternalServerError);
		}
	);

	it("preserves OrganizationHasDependents from delete", async () => {
		const failure = new OrganizationHasDependents(targetId.toString());
		const repo = repository({ deleteOrganization: vi.fn(() => Effect.fail(failure)) });

		const error = await runService(repo, service =>
			Effect.flip(service.deleteOrganization(targetId))
		);

		expect(error).toBe(failure);
	});

	it("exposes only HttpErrors from service error channels", () => {
		expectTypeOf<OrganizationListError>().toMatchTypeOf<HttpError>();
		expectTypeOf<OrganizationGetError>().toMatchTypeOf<HttpError>();
		expectTypeOf<OrganizationCreateError>().toMatchTypeOf<HttpError>();
		expectTypeOf<OrganizationUpdateError>().toMatchTypeOf<HttpError>();
		expectTypeOf<OrganizationDeleteError>().toMatchTypeOf<HttpError>();
	});
});
