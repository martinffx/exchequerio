import fastifySwagger from "@fastify/swagger";
import { Effect, Layer } from "effect";
import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalErrorHandler } from "@/lib/errors";
import { newOrgID } from "@/lib/ids";
import { ServerRuntime } from "@/runtime";
import { Asset } from "./Asset";
import { AssetRoutes } from "./AssetRoutes";
import { AssetService, AssetServiceTag } from "./AssetService";

const orgId = newOrgID();
const asset = Asset.fromRequest(
	"ast_01h2x3y4z5a6b7c8d9e0f1g2h4",
	orgId,
	{ code: "USD", name: "Dollar", minorUnitExponent: 2 },
	new Date()
);
const servers: FastifyInstance[] = [];
const buildServer = async () => {
	const service = Object.create(AssetService.prototype) as AssetService;
	vi.spyOn(service, "createAsset").mockReturnValue(Effect.succeed(asset));
	vi.spyOn(service, "updateAsset").mockReturnValue(Effect.succeed(asset));
	vi.spyOn(service, "listAssets").mockReturnValue(Effect.succeed([asset]));
	const server = fastify();
	const runtime = new ServerRuntime(Layer.succeed(AssetServiceTag, service));
	server.decorate("runtime", runtime as never);
	server.decorateRequest("token");
	server.addHook("preHandler", async request => {
		request.token = { orgId } as never;
	});
	const permissions = vi.fn(() => async () => undefined);
	server.decorate("hasPermissions", permissions);
	server.setErrorHandler(globalErrorHandler);
	await server.register(fastifySwagger, { openapi: { info: { title: "Assets", version: "1" } } });
	await server.register(AssetRoutes, { prefix: "/api/assets" });
	await server.ready();
	servers.push(server);
	return { server, service, permissions };
};
afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("Asset HTTP contract", () => {
	it.each([
		{ code: "BAD CODE", name: "Invalid", minorUnitExponent: 2 },
		{ code: "", name: "Invalid", minorUnitExponent: 2 },
		{ code: "USD", name: "   ", minorUnitExponent: 2 },
		{ code: "X".repeat(65), name: "Invalid", minorUnitExponent: 2 },
		{ code: "USD", name: "Invalid" },
		{ code: "USD", name: "Invalid", minorUnitExponent: -1 },
		{ code: "USD", name: "Invalid", minorUnitExponent: 19 },
		{ code: "USD", name: "Invalid", minorUnitExponent: 2.5 },
		{ code: "USD", name: "Invalid", minorUnitExponent: "2" },
		{ code: "USD", name: "Invalid", minorUnitExponent: 2, metadata: { count: 1 } },
	])("rejects invalid creation input %#", async payload => {
		const { server, service } = await buildServer();
		const response = await server.inject({ method: "POST", url: "/api/assets", payload });
		expect(response.statusCode).toBe(400);
		expect(service.createAsset).not.toHaveBeenCalled();
	});
	it("rejects replacement of immutable fields", async () => {
		const { server, service } = await buildServer();
		const response = await server.inject({
			method: "PUT",
			url: `/api/assets/${asset.id}`,
			payload: { code: "USD", name: "Dollar", minorUnitExponent: 3 },
		});
		expect(response.statusCode).toBe(400);
		expect(service.updateAsset).not.toHaveBeenCalled();
	});
	it("generates OpenAPI from schemas and declares permissions", async () => {
		const { server, permissions } = await buildServer();
		expect(permissions.mock.calls).toEqual([
			[["asset:read"]],
			[["asset:read"]],
			[["asset:write"]],
			[["asset:write"]],
			[["asset:delete"]],
		]);
		const operation = server.swagger().paths?.["/api/assets/"]?.post;
		expect(operation?.responses).toHaveProperty("409");
		expect(JSON.stringify(operation)).toContain("minorUnitExponent");
	});
	it("rejects offsets beyond the shared pagination limit", async () => {
		const { server, service } = await buildServer();
		const response = await server.inject({ method: "GET", url: "/api/assets?offset=10001" });
		expect(response.statusCode).toBe(400);
		expect(service.listAssets).not.toHaveBeenCalled();
	});
	it("passes tenant scope and pagination defaults to list", async () => {
		const { server, service } = await buildServer();
		const response = await server.inject({ method: "GET", url: "/api/assets?code=usd" });
		expect(response.statusCode).toBe(200);
		expect(service.listAssets).toHaveBeenCalledWith(orgId, { offset: 0, limit: 20, code: "usd" });
	});
});
