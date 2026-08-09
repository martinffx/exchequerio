import fastifySwagger from "@fastify/swagger";
import { Effect, Layer } from "effect";
import fastify, { type FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalErrorHandler, ServiceUnavailableError } from "@/lib/errors";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import { ServerRuntime } from "@/runtime";
import { Ledger } from "./domain/Ledger";
import { LedgerHasDependents, LedgerNotFound } from "./LedgerErrors";
import { LedgerRoutes } from "./LedgerRoutes";
import type { LedgerService } from "./LedgerService";
import { LedgerServiceTag } from "./LedgerService";

const organizationId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const ledger = new Ledger({
	id: ledgerId,
	organizationId,
	name: "Operating Ledger",
	description: "Primary book",
	metadata: { externalId: "book-42" },
	created: new Date("2026-08-09T10:00:00.000Z"),
	updated: new Date("2026-08-09T10:00:00.000Z"),
});

const service = (): LedgerService =>
	vi.mocked<LedgerService>({
		listLedgers: vi.fn(() => Effect.succeed([ledger])),
		getLedger: vi.fn(() => Effect.succeed(ledger)),
		createLedger: vi.fn(() => Effect.succeed(ledger)),
		updateLedger: vi.fn(() => Effect.succeed(ledger)),
		deleteLedger: vi.fn(() => Effect.succeed(ledger)),
	} as unknown as LedgerService);

const servers: FastifyInstance[] = [];

const buildRouteServer = async (implementation: LedgerService) => {
	const server = fastify();
	const hasPermissions = vi.fn(() => async () => undefined);
	server.setErrorHandler(globalErrorHandler);
	const runtime = new ServerRuntime(Layer.succeed(LedgerServiceTag, implementation));
	server.decorate("runtime", runtime as never);
	server.decorateRequest("token");
	server.addHook("preHandler", async request => {
		request.token = {
			orgId: organizationId,
			organizationId,
			permissions: new Set(["ledger:read", "ledger:write", "ledger:delete"]),
		} as never;
	});
	server.decorate("hasPermissions", hasPermissions);
	await server.register(fastifySwagger, {
		openapi: { info: { title: "Ledger route test", version: "1" } },
	});
	await server.register(LedgerRoutes, { prefix: "/api/ledgers" });
	await server.ready();
	servers.push(server);
	return { server, runtime, hasPermissions };
};

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("LedgerRoutes", () => {
	it("keeps the five existing permission declarations", async () => {
		const { hasPermissions } = await buildRouteServer(service());

		expect(hasPermissions.mock.calls).toEqual([
			[["ledger:read"]],
			[["ledger:read"]],
			[["ledger:write"]],
			[["ledger:write"]],
			[["ledger:delete"]],
		]);
	});

	it("forwards list pagination defaults and the authenticated Organization", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({ method: "GET", url: "/api/ledgers" });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([
			{
				id: ledgerId.toString(),
				name: "Operating Ledger",
				description: "Primary book",
				metadata: { externalId: "book-42" },
				created: "2026-08-09T10:00:00.000Z",
				updated: "2026-08-09T10:00:00.000Z",
			},
		]);
		expect(response.json()).not.toHaveProperty("currency");
		expect(implementation.listLedgers).toHaveBeenCalledWith(organizationId, {
			offset: 0,
			limit: 20,
		});
	});

	it("forwards explicit list pagination", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "GET",
			url: "/api/ledgers?offset=10000&limit=100",
		});

		expect(response.statusCode).toBe(200);
		expect(implementation.listLedgers).toHaveBeenCalledWith(organizationId, {
			offset: 10_000,
			limit: 100,
		});
	});

	it.each(["offset=-1", "offset=10001", "limit=0", "limit=101", "offset=1.5"])(
		"rejects invalid pagination: %s",
		async query => {
			const implementation = service();
			const { server } = await buildRouteServer(implementation);

			const response = await server.inject({ method: "GET", url: `/api/ledgers?${query}` });

			expect(response.statusCode).toBe(400);
			expect(implementation.listLedgers).not.toHaveBeenCalled();
		}
	);

	it("passes the tenant and canonical Ledger ID to get", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/${ledgerId.toString()}`,
		});

		expect(response.statusCode).toBe(200);
		expect(implementation.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
	});

	it.each(["not-a-ledger", ledgerId.toString().toUpperCase()])(
		"rejects malformed or noncanonical Ledger ID %s",
		async invalidId => {
			const implementation = service();
			const { server } = await buildRouteServer(implementation);

			const response = await server.inject({
				method: "GET",
				url: `/api/ledgers/${invalidId}`,
			});

			expect(response.statusCode).toBe(400);
			expect(implementation.getLedger).not.toHaveBeenCalled();
		}
	);

	it("strips undeclared create fields and returns 201 with Location", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "POST",
			url: "/api/ledgers",
			payload: {
				name: "Operating Ledger",
				description: "Primary book",
				metadata: { externalId: "book-42" },
				currency: "EUR",
				currencyExponent: 2,
				ignored: true,
			},
		});

		expect(response.statusCode).toBe(201);
		expect(response.headers.location).toBe(`/api/ledgers/${ledgerId.toString()}`);
		expect(response.json()).not.toHaveProperty("currency");
		expect(implementation.createLedger).toHaveBeenCalledWith(organizationId, {
			name: "Operating Ledger",
			description: "Primary book",
			metadata: { externalId: "book-42" },
		});
	});

	it("strips undeclared update fields and forwards replacement input", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "PUT",
			url: `/api/ledgers/${ledgerId.toString()}`,
			payload: { name: "Replaced", currency: "EUR", ignored: true },
		});

		expect(response.statusCode).toBe(200);
		expect(implementation.updateLedger).toHaveBeenCalledWith(organizationId, ledgerId, {
			name: "Replaced",
		});
	});

	it.each([
		["POST", "/api/ledgers", {}],
		["PUT", `/api/ledgers/${ledgerId.toString()}`, { name: "Valid", metadata: "invalid" }],
	] as const)("rejects malformed declared fields for %s", async (method, url, payload) => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({ method, url, payload });

		expect(response.statusCode).toBe(400);
	});

	it("deletes with an empty 204 and forwards tenant scope", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "DELETE",
			url: `/api/ledgers/${ledgerId.toString()}`,
		});

		expect(response.statusCode).toBe(204);
		expect(response.body).toBe("");
		expect(implementation.deleteLedger).toHaveBeenCalledWith(organizationId, ledgerId);
	});

	it("maps typed not-found and dependency failures", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getLedger)
			.mockReturnValue(
				Effect.fail(new LedgerNotFound(organizationId.toString(), ledgerId.toString()))
			);
		vi
			.mocked(implementation.deleteLedger)
			.mockReturnValue(
				Effect.fail(new LedgerHasDependents(organizationId.toString(), ledgerId.toString()))
			);
		const { server } = await buildRouteServer(implementation);

		const notFound = await server.inject({
			method: "GET",
			url: `/api/ledgers/${ledgerId.toString()}`,
		});
		const conflict = await server.inject({
			method: "DELETE",
			url: `/api/ledgers/${ledgerId.toString()}`,
		});

		expect(notFound.statusCode).toBe(404);
		expect(notFound.json()).toMatchObject({
			type: "NOT_FOUND",
			organizationId: organizationId.toString(),
			ledgerId: ledgerId.toString(),
		});
		expect(conflict.statusCode).toBe(409);
	});

	it("returns non-retryable 503 for create-time unavailability", async () => {
		const implementation = service();
		vi
			.mocked(implementation.createLedger)
			.mockReturnValue(
				Effect.fail(new ServiceUnavailableError("Ledger repository unavailable", { retryable: false }))
			);
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "POST",
			url: "/api/ledgers",
			payload: { name: "Operating Ledger" },
		});

		expect(response.statusCode).toBe(503);
		expect(response.json()).toMatchObject({ type: "SERVICE_UNAVAILABLE", retryable: false });
	});

	it("advertises only operation-specific failures", async () => {
		const { server } = await buildRouteServer(service());
		const specification: unknown = server.swagger();

		expect(specification).toMatchObject({
			paths: {
				"/api/ledgers/": {
					post: { responses: { 201: {}, 404: {} } },
				},
				"/api/ledgers/{ledgerId}": {
					delete: { responses: { 409: {} } },
				},
			},
		});
		expect(specification).not.toMatchObject({
			paths: {
				"/api/ledgers/": { post: { responses: { 409: {} } } },
			},
		});
		expect(specification).not.toMatchObject({
			paths: {
				"/api/ledgers/{ledgerId}": { put: { responses: { 409: {} } } },
			},
		});
		expect(JSON.stringify(specification)).not.toContain('"429"');
	});
});
