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
import type { LedgerAccountBalanceMonitorResponse } from "./LedgerAccountBalanceMonitorSchema";
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
	description: "Test balance monitor",
	alertCondition: {
		mode: "all",
		conditions: [{ balanceType: "posted", operator: "<", value: 100 }],
	},
	webhook: { url: "https://example.com/hook", bearerToken: "secret" },
	metadata: {},
};
const scope = {
	organizationId: organizationId.toString(),
	ledgerId,
	accountId: accountId.toString(),
};
const monitor = Effect.runSync(
	LedgerAccountBalanceMonitor.fromRequest(
		monitorId,
		scope,
		{ ...request, metadata: undefined },
		DateTime.fromISO("2025-01-01T00:00:00.000Z", { zone: "utc" }),
		"ciphertext"
	)
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
	it.each([
		['{"period":"monthly"}', { period: "monthly" }],
		["{}", {}],
		['{"period":"monthly","count":1}', undefined],
		['{"nested":{"toString":null}}', undefined],
		['["monthly"]', undefined],
		['"monthly"', undefined],
		["1", undefined],
		["true", undefined],
		["null", undefined],
		["not-json", undefined],
	])("safely returns stored metadata %s on GET and list", async (metadata, expected) => {
		const stored = await Effect.runPromise(
			LedgerAccountBalanceMonitor.fromRow({
				...monitor.row,
				metadata,
			})
		);
		const implementation = service();
		implementation.getLedgerAccountBalanceMonitor.mockReturnValue(Effect.succeed(stored));
		implementation.listLedgerAccountBalanceMonitors.mockReturnValue(Effect.succeed([stored]));
		const { server } = await buildRouteServer(implementation);
		const [get, list] = await Promise.all([
			server.inject({
				method: "GET",
				headers: authorize(),
				url: itemUrl,
			}),
			server.inject({ method: "GET", headers: authorize(), url: collectionUrl }),
		]);

		expect(get.statusCode).toBe(200);
		expect(list.statusCode).toBe(200);
		for (const body of [
			get.json<LedgerAccountBalanceMonitorResponse>(),
			list.json<LedgerAccountBalanceMonitorResponse[]>()[0],
		]) {
			expect(body.id).toBe(monitorId.toString());
			if (expected === undefined) expect(body).not.toHaveProperty("metadata");
			else expect(body.metadata).toEqual(expected);
		}
	});

	it("forwards authenticated scope on GET and redacts credentials", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const response = await server.inject({ method: "GET", url: itemUrl, headers: authorize() });
		expect(response.statusCode).toBe(200);
		expect(implementation.getLedgerAccountBalanceMonitor).toHaveBeenCalledWith(
			scope,
			monitorId.toString()
		);
		expect(response.json()).toMatchObject({
			alertCondition: request.alertCondition,
			webhook: { url: request.webhook.url },
			lockVersion: 1,
		});
		expect(response.body).not.toContain("secret");
		expect(response.json()).not.toHaveProperty("balances");
	});
	it("requires a token on creation and permits omission on update", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const payload = { ...request, webhook: { url: request.webhook.url } };
		const created = await server.inject({
			method: "POST",
			url: collectionUrl,
			headers: authorize(),
			payload,
		});
		expect(created.statusCode).toBe(400);
		const updated = await server.inject({
			method: "PUT",
			url: itemUrl,
			headers: authorize(),
			payload,
		});
		expect(updated.statusCode).toBe(200);
	});
	it.each([
		{ mode: "all", conditions: [] },
		{ mode: "all", conditions: [{ balanceType: "posted", operator: "<", value: 0.5 }] },
		{
			mode: "all",
			conditions: [{ balanceType: "posted", operator: "<", value: Number.MAX_SAFE_INTEGER + 1 }],
		},
		{ mode: "all", conditions: [{ balanceType: "missing", operator: "<", value: 1 }] },
		{ mode: "nested", conditions: [{ balanceType: "posted", operator: "<", value: 1 }] },
	])("rejects invalid conditions %#", async alertCondition => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const response = await server.inject({
			method: "POST",
			url: collectionUrl,
			headers: authorize(),
			payload: { ...request, alertCondition },
		});
		expect(response.statusCode).toBe(400);
		expect(implementation.createLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
	});
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
		implementation.createLedgerAccountBalanceMonitor.mockImplementation((scope, body) =>
			LedgerAccountBalanceMonitor.fromRequest(
				monitorId,
				scope,
				body,
				DateTime.fromJSDate(monitor.row.updated),
				"ciphertext"
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
		expect(implementation.createLedgerAccountBalanceMonitor).toHaveBeenCalledWith(scope, {
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
		expect(implementation.listLedgerAccountBalanceMonitors).toHaveBeenCalledWith(scope, 0, 20);
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
		expect(implementation.listLedgerAccountBalanceMonitors).toHaveBeenCalledWith(scope, 10, 5);
	});

	it("rejects malformed parent path IDs", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/not-a-ledger/accounts/not-an-account/balance-monitors/${monitorId.toString()}`,
			headers: authorize(),
		});
		expect(response.statusCode).toBe(400);
		expect(implementation.getLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
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
		expect(implementation.createLedgerAccountBalanceMonitor).toHaveBeenCalledWith(scope, request);
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
			scope,
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
			scope,
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
