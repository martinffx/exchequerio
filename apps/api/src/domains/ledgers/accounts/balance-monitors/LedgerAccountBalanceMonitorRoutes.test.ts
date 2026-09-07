import { Effect, Layer } from "effect";
import fastifySwagger from "@fastify/swagger";
import fastify, { type FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerAuth, signJWT } from "@/auth";
import { Config } from "@/config";
import { globalErrorHandler, InternalServerError } from "@/lib/errors";
import type { LedgerAccountBalanceMonitorID, LedgerAccountID, OrgID } from "@/repo/entities/types";
import { ServerRuntime } from "@/runtime";
import { buildServer } from "@/server";

import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import { LedgerAccountBalanceMonitorNotFound } from "./LedgerAccountBalanceMonitorErrors";
import { LedgerAccountBalanceMonitorRoutes } from "./LedgerAccountBalanceMonitorRoutes";
import type { LedgerAccountBalanceMonitorRequest } from "./LedgerAccountBalanceMonitorSchema";
import {
	LedgerAccountBalanceMonitorService,
	LedgerAccountBalanceMonitorServiceTag,
} from "./LedgerAccountBalanceMonitorService";

const organizationId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
const ledgerId = "lgr_01h2x3y4z5a6b7c8d9e0f1g2h4";
const monitorId = TypeID.fromString<"lbm">(
	"lbm_01h2x3y4z5a6b7c8d9e0f1g2h5"
) as LedgerAccountBalanceMonitorID;
const accountId = TypeID.fromString<"lat">("lat_01h2x3y4z5a6b7c8d9e0f1g2h6") as LedgerAccountID;
const request: LedgerAccountBalanceMonitorRequest = {
	accountId: accountId.toString(),
	description: "Test balance monitor",
	alertCondition: [],
	metadata: {},
};
const monitor = LedgerAccountBalanceMonitor.fromRequest(
	monitorId,
	accountId,
	{ ...request, metadata: undefined },
	DateTime.fromISO("2025-01-01T00:00:00.000Z", { zone: "utc" })
);
const collectionUrl = `/api/ledgers/${ledgerId}/accounts/${accountId.toString()}/balance-monitors`;
const itemUrl = `${collectionUrl}/${monitorId.toString()}`;
const routePrefix = "/api/ledgers/:ledgerId/accounts/:accountId/balance-monitors";
const adminToken = signJWT({ sub: organizationId.toString(), scope: ["org_admin"] });
const readOnlyToken = signJWT({ sub: organizationId.toString(), scope: ["org_readonly"] });
const authorize = (token = adminToken) => ({ authorization: `Bearer ${token}` });

const service = () =>
	({
		listLedgerAccountBalanceMonitors: vi.fn<
			LedgerAccountBalanceMonitorService["listLedgerAccountBalanceMonitors"]
		>(() => Effect.succeed([monitor])),
		getLedgerAccountBalanceMonitor: vi.fn<
			LedgerAccountBalanceMonitorService["getLedgerAccountBalanceMonitor"]
		>(() => Effect.succeed(monitor)),
		createLedgerAccountBalanceMonitor: vi.fn<
			LedgerAccountBalanceMonitorService["createLedgerAccountBalanceMonitor"]
		>(() => Effect.succeed(monitor)),
		updateLedgerAccountBalanceMonitor: vi.fn<
			LedgerAccountBalanceMonitorService["updateLedgerAccountBalanceMonitor"]
		>(() => Effect.succeed(monitor)),
		deleteLedgerAccountBalanceMonitor: vi.fn<
			LedgerAccountBalanceMonitorService["deleteLedgerAccountBalanceMonitor"]
		>(() => Effect.void),
	}) satisfies Pick<LedgerAccountBalanceMonitorService, keyof LedgerAccountBalanceMonitorService>;

const servers: FastifyInstance[] = [];

const buildRouteServer = async (implementation: ReturnType<typeof service>) => {
	const server = fastify();
	server.decorate("config", new Config());
	server.setErrorHandler(globalErrorHandler);
	await registerAuth(server);
	server.addHook("preHandler", server.auth([server.verifyJWT]));
	await server.register(fastifySwagger, {
		openapi: { info: { title: "Balance Monitor route test", version: "1" } },
	});
	const hasPermissions = vi.spyOn(server, "hasPermissions");
	const runtime = new ServerRuntime(
		// The complete public double omits only the class's private repository field.
		Layer.succeed(
			LedgerAccountBalanceMonitorServiceTag,
			implementation as unknown as LedgerAccountBalanceMonitorService
		)
	);
	server.decorate("runtime", runtime as never);
	server.addHook("onClose", () => runtime.dispose());
	await server.register(LedgerAccountBalanceMonitorRoutes, { prefix: routePrefix });
	await server.ready();
	servers.push(server);
	return { server, runtime, hasPermissions };
};

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("LedgerAccountBalanceMonitorRoutes", () => {
	it("keeps the five existing permission declarations", async () => {
		const { hasPermissions } = await buildRouteServer(service());

		expect(hasPermissions.mock.calls).toEqual([
			[["ledger:account:balance_monitor:read"]],
			[["ledger:account:balance_monitor:read"]],
			[["ledger:account:balance_monitor:write"]],
			[["ledger:account:balance_monitor:write"]],
			[["ledger:account:balance_monitor:delete"]],
		]);
	});

	it("preserves the complete OpenAPI contract", async () => {
		const { server } = await buildRouteServer(service());
		const { paths } = server.swagger();
		expect({ paths }).toMatchSnapshot();
	});

	it("preserves metadata key-value pairs on the wire", async () => {
		const implementation = service();
		implementation.createLedgerAccountBalanceMonitor.mockImplementation(body =>
			Effect.succeed(
				LedgerAccountBalanceMonitor.fromRequest(monitorId, accountId, body, monitor.updated)
			)
		);
		const { server } = await buildRouteServer(implementation);
		const metadata = { team: "treasury", purpose: "low balance" };
		const response = await server.inject({
			method: "POST",
			url: collectionUrl,
			headers: authorize(),
			payload: { ...request, metadata },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ metadata });
		expect(implementation.createLedgerAccountBalanceMonitor).toHaveBeenCalledWith({
			...request,
			metadata,
		});
	});

	it.each([
		{ method: "GET", headers: authorize("invalid-token"), status: 401 },
		{ method: "POST", headers: authorize(readOnlyToken), status: 403 },
	] as const)(
		"protects the production $method route with $status",
		async ({ method, headers, status }) => {
			const server = await buildServer();
			servers.push(server);
			const response = await server.inject({
				method,
				url: collectionUrl,
				headers,
				...(method === "POST" ? { payload: request } : {}),
			});
			expect(response.statusCode).toBe(status);
		}
	);

	it("lists through the Effect service with the existing defaults and response", async () => {
		const implementation = service();
		const { server, runtime } = await buildRouteServer(implementation);
		const runPromise = vi.spyOn(runtime, "runPromise");

		const response = await server.inject({ method: "GET", url: collectionUrl, headers: authorize() });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchSnapshot();
		expect(implementation.listLedgerAccountBalanceMonitors).toHaveBeenCalledWith(0, 20);
		expect(runPromise).toHaveBeenCalledOnce();
	});

	it("forwards explicit list pagination", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "GET",
			url: `${collectionUrl}?offset=10&limit=5`,
			headers: authorize(),
		});

		expect(response.statusCode).toBe(200);
		expect(implementation.listLedgerAccountBalanceMonitors).toHaveBeenCalledWith(10, 5);
	});

	it("gets through the Effect service and ignores parent path IDs", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/not-a-ledger/accounts/not-an-account/balance-monitors/${monitorId.toString()}`,
			headers: authorize(),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchSnapshot();
		expect(implementation.getLedgerAccountBalanceMonitor).toHaveBeenCalledWith(monitorId.toString());
	});

	it("creates with the existing 200 response", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "POST",
			url: collectionUrl,
			headers: authorize(),
			payload: request,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchSnapshot();
		expect(implementation.createLedgerAccountBalanceMonitor).toHaveBeenCalledWith(request);
	});

	it("updates with the existing response and service inputs", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "PUT",
			url: itemUrl,
			headers: authorize(),
			payload: request,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchSnapshot();
		expect(implementation.updateLedgerAccountBalanceMonitor).toHaveBeenCalledWith(
			monitorId.toString(),
			request
		);
	});

	it("deletes with the existing empty 200 response", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({ method: "DELETE", url: itemUrl, headers: authorize() });

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe("");
		expect(implementation.deleteLedgerAccountBalanceMonitor).toHaveBeenCalledWith(
			monitorId.toString()
		);
	});

	it.each(["get", "update", "delete"] as const)(
		"maps missing %s results to the existing 404 response",
		async operation => {
			const implementation = service();
			const failure = Effect.fail(new LedgerAccountBalanceMonitorNotFound(monitorId));
			if (operation === "get")
				vi.mocked(implementation.getLedgerAccountBalanceMonitor).mockReturnValue(failure);
			if (operation === "update")
				vi.mocked(implementation.updateLedgerAccountBalanceMonitor).mockReturnValue(failure);
			if (operation === "delete")
				vi.mocked(implementation.deleteLedgerAccountBalanceMonitor).mockReturnValue(failure);
			const { server } = await buildRouteServer(implementation);

			const response = await server.inject({
				method: operation === "update" ? "PUT" : operation === "delete" ? "DELETE" : "GET",
				url: itemUrl,
				headers: authorize(),
				...(operation === "update" ? { payload: request } : {}),
			});

			expect(response.statusCode).toBe(404);
			expect(response.json()).toMatchObject({
				type: "NOT_FOUND",
				detail: `Balance monitor not found: ${monitorId.toString()}`,
			});
		}
	);

	it("preserves pagination validation", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const invalid = await server.inject({
			method: "GET",
			url: `${collectionUrl}?offset=invalid`,
			headers: authorize(),
		});
		expect(invalid.statusCode).toBe(400);
		expect(implementation.listLedgerAccountBalanceMonitors).not.toHaveBeenCalled();
	});

	it("keeps unexpected service failures on the sanitized 500 path", async () => {
		const implementation = service();
		vi
			.mocked(implementation.listLedgerAccountBalanceMonitors)
			.mockReturnValue(Effect.fail(new InternalServerError("Internal Server Error")));
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({ method: "GET", url: collectionUrl, headers: authorize() });

		expect(response.statusCode).toBe(500);
		expect(response.json()).toMatchObject({
			type: "INTERNAL_SERVER_ERROR",
			detail: "Internal Server Error",
		});
	});
});
