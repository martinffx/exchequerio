import fastify, { type FastifyInstance } from "fastify";
import { Effect, Layer } from "effect";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalErrorHandler } from "@/lib/errors";
import type { OrgID } from "../repo/entities/types";
import { ServerRuntime } from "@/runtime";
import { Organization } from "./domain/Organization";
import { OrganizationNotFound } from "./domain/OrganizationErrors";
import type { OrganizationService } from "./OrganizationService";
import { OrganizationServiceTag } from "./OrganizationService";
import { OrganizationRoutes } from "./OrganizationRoutes";

const organizationId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
const organization = Organization.fromRequest(organizationId, {
	name: "Example",
});

const service = (): OrganizationService =>
	vi.mocked<OrganizationService>({
		listOrganizations: vi.fn(() => Effect.succeed([organization])),
		getOrganization: vi.fn(() => Effect.succeed(organization)),
		createOrganization: vi.fn(() => Effect.succeed(organization)),
		updateOrganization: vi.fn(() => Effect.succeed(organization)),
		deleteOrganization: vi.fn(() => Effect.succeed(organization)),
	} as unknown as OrganizationService);

const servers: FastifyInstance[] = [];

const buildRouteServer = async (implementation: OrganizationService) => {
	const server = fastify();
	const hasPermissions = vi.fn(() => async () => undefined);
	server.setErrorHandler(globalErrorHandler);
	const runtime = new ServerRuntime(Layer.succeed(OrganizationServiceTag, implementation));
	server.decorate("runtime", runtime as never);
	server.decorateRequest("token");
	server.addHook("preHandler", async request => {
		request.token = {
			orgId: organizationId,
			organizationId,
			permissions: new Set(["organization:read", "organization:write"]),
		} as never;
	});
	server.decorate("hasPermissions", hasPermissions);
	await server.register(OrganizationRoutes, { prefix: "/api/organizations" });
	await server.ready();
	servers.push(server);
	return { server, runtime, hasPermissions };
};

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("OrganizationRoutes", () => {
	it("reserves existing routes for platform permissions", async () => {
		const { hasPermissions } = await buildRouteServer(service());

		expect(hasPermissions.mock.calls).toEqual([
			[["organization:read"]],
			[["organization:read"]],
			[["organization:write"]],
			[["organization:write"]],
			[["organization:delete"]],
		]);
	});

	it("creates through the Effect service with 201 and Location", async () => {
		const implementation = service();
		const { server, runtime } = await buildRouteServer(implementation);
		const runPromise = vi.spyOn(runtime, "runPromise");

		const response = await server.inject({
			method: "POST",
			url: "/api/organizations",
			payload: { name: "Example" },
		});

		expect(response.statusCode).toBe(201);
		expect(response.headers.location).toBe(`/api/organizations/${organizationId.toString()}`);
		expect(response.json()).toMatchObject({ id: organizationId.toString(), name: "Example" });
		expect(response.json()).not.toHaveProperty("description");
		expect(implementation.createOrganization).toHaveBeenCalledWith({ name: "Example" });
		expect(runPromise).toHaveBeenCalledOnce();
	});

	it("deletes through the Effect service with an empty 204 response", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "DELETE",
			url: `/api/organizations/${organizationId.toString()}`,
		});

		expect(response.statusCode).toBe(204);
		expect(response.body).toBe("");
		expect(implementation.deleteOrganization).toHaveBeenCalledWith(organizationId);
	});

	it("maps permitted absence through the Effect boundary", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getOrganization)
			.mockReturnValue(Effect.fail(new OrganizationNotFound(organizationId.toString())));
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "GET",
			url: `/api/organizations/${organizationId.toString()}`,
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			type: "NOT_FOUND",
			organizationId: organizationId.toString(),
		});
	});
});
