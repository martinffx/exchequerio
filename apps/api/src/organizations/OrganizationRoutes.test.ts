import fastify, { type FastifyInstance } from "fastify";
import { Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerRuntime } from "../runtime/ServerRuntime";
import type { OrganizationId } from "./domain/OrganizationId";
import { createOrganization } from "./domain/Organization";
import type { OrganizationService } from "./OrganizationService";
import { OrganizationServiceTag } from "./OrganizationService";
import { OrganizationRoutes } from "./OrganizationRoutes";

const organizationId = "org_01h2x3y4z5a6b7c8d9e0f1g2h3" as OrganizationId;
const timestamp = DateTime.fromISO("2026-08-04T10:00:00.000Z", { zone: "utc" });
const organization = createOrganization({
	id: organizationId,
	name: "Example",
	created: timestamp,
	updated: timestamp,
});

const service = (): OrganizationService =>
	vi.mocked<OrganizationService>({
		list: vi.fn(() => Effect.succeed([organization])),
		get: vi.fn(() => Effect.succeed(organization)),
		create: vi.fn(() => Effect.succeed(organization)),
		update: vi.fn(() => Effect.succeed(organization)),
		delete: vi.fn(() => Effect.succeed(organization)),
	} as unknown as OrganizationService);

const servers: FastifyInstance[] = [];

const buildRouteServer = async (implementation: OrganizationService) => {
	const server = fastify();
	const runtime = new ServerRuntime(Layer.succeed(OrganizationServiceTag, implementation));
	server.decorate("runtime", runtime as never);
	server.decorateRequest("token");
	server.addHook("preHandler", async request => {
		request.token = {
			orgId: organizationId,
			permissions: new Set(["organization:read", "organization:write"]),
		} as never;
	});
	server.decorate("organizationRateLimit", async () => undefined);
	await server.register(OrganizationRoutes, { prefix: "/api/organizations" });
	await server.ready();
	servers.push(server);
	return server;
};

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("OrganizationRoutes", () => {
	it("creates through the Effect service with 201 and Location", async () => {
		const implementation = service();
		const server = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "POST",
			url: "/api/organizations",
			payload: { name: "Example" },
		});

		expect(response.statusCode).toBe(201);
		expect(response.headers.location).toBe(`/api/organizations/${organizationId}`);
		expect(response.json()).toMatchObject({ id: organizationId, name: "Example" });
		expect(response.json()).not.toHaveProperty("description");
		expect(implementation.create).toHaveBeenCalledOnce();
	});

	it("deletes through the Effect service with an empty 204 response", async () => {
		const implementation = service();
		const server = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "DELETE",
			url: `/api/organizations/${organizationId}`,
		});

		expect(response.statusCode).toBe(204);
		expect(response.body).toBe("");
		expect(implementation.delete).toHaveBeenCalledOnce();
	});

	it("maps permitted absence through the Effect boundary", async () => {
		const implementation = service();
		vi.mocked(implementation.get).mockReturnValue(
			Effect.fail({
				_tag: "OrganizationNotFound",
				organizationId,
			} as never)
		);
		const server = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "GET",
			url: `/api/organizations/${organizationId}`,
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({ type: "NOT_FOUND", organizationId });
	});
});
