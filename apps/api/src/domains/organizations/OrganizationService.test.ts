import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { HttpError, InternalServerError, ServiceUnavailableError } from "@/lib/errors";
import type { OrgID } from "@/lib/ids";
import { Organization } from "./Organization";
import {
	OrganizationHasDependents,
	OrganizationNotFound,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "./OrganizationErrors";
import type { OrganizationRepo } from "./OrganizationRepo";
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

const repo = vi.mocked<OrganizationRepo>({
	listOrganizations: vi.fn(() => Effect.succeed([organization])),
	getOrganization: vi.fn(() => Effect.succeed(someOrganization)),
	createOrganization: vi.fn(record => Effect.succeed(record)),
	updateOrganization: vi.fn(() => Effect.succeed(someOrganization)),
	deleteOrganization: vi.fn(() => Effect.succeed(someOrganization)),
});
const idGenerator = vi.mocked<OrganizationIdGenerator>({
	generate: vi.fn(() => Effect.succeed(generatedId)),
});
const runtime = ManagedRuntime.make(
	organizationServiceLayer.pipe(
		Layer.provide(
			Layer.merge(
				Layer.succeed(OrganizationRepoTag, repo),
				Layer.succeed(OrganizationIdGeneratorTag, idGenerator)
			)
		)
	)
);
let service: OrganizationService;
beforeAll(async () => {
	service = await runtime.runPromise(OrganizationServiceTag);
});
beforeEach(() => {
	vi.resetAllMocks();
});
afterAll(() => runtime.dispose());

const repositoryMethods = {
	list: "listOrganizations",
	get: "getOrganization",
	create: "createOrganization",
	update: "updateOrganization",
	delete: "deleteOrganization",
} as const;
type Operation = keyof typeof repositoryMethods;

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
		const result = await runtime.runPromise(service.listOrganizations({ offset: 10, limit: 5 }));

		expect(result).toEqual([organization]);
		expect(repo.listOrganizations).toHaveBeenCalledWith({ offset: 10, limit: 5 });
	});

	it("returns an existing Organization", async () => {
		const result = await runtime.runPromise(service.getOrganization(targetId));

		expect(result).toBe(organization);
		expect(repo.getOrganization).toHaveBeenCalledWith(targetId);
	});

	it.each(["get", "update", "delete"] as const)(
		"maps missing %s results to OrganizationNotFound",
		async operation => {
			repo[repositoryMethods[operation]].mockReturnValue(Effect.succeed(Option.none()));

			const error = await runtime.runPromise(Effect.flip(invoke(service, operation)));

			expect(error).toEqual(new OrganizationNotFound());
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
		repo.createOrganization.mockImplementation(record => Effect.succeed(record));
		repo.updateOrganization.mockImplementation(record =>
			Effect.succeed(Option.fromNullishOr(record))
		);

		const result = await runtime.runPromise(
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
			repo[repositoryMethods[operation]].mockReturnValue(Effect.fail(failure));
			const error = await runtime.runPromise(Effect.flip(invoke(service, operation)));

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
			repo[repositoryMethods[operation]].mockReturnValue(Effect.fail(failure));
			const error = await runtime.runPromise(Effect.flip(invoke(service, operation)));

			expect(error).toBe(failure);
			expect(error).toBeInstanceOf(InternalServerError);
		}
	);

	it("preserves OrganizationHasDependents from delete", async () => {
		const failure = new OrganizationHasDependents();
		repo.deleteOrganization.mockImplementation(() => Effect.fail(failure));

		const error = await runtime.runPromise(Effect.flip(service.deleteOrganization(targetId)));

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
