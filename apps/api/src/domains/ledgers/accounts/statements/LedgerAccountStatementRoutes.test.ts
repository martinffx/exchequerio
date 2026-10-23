import { Config } from "@/config";
import fastifySwagger from "@fastify/swagger";
import { Effect, Layer, Option } from "effect";
import fastify, { type FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { encodeUuid } from "@/lib/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signJWT } from "@/auth";
import { ConflictError, globalErrorHandler, NotFoundError } from "@/lib/errors";
import type { OrgID, LedgerID, LedgerAccountID, LedgerAccountStatementID } from "@/lib/ids";
import { ServerConfigTag, ServerRuntime, type ServerRuntimeLayer } from "@/runtime";
import { buildServer } from "@/server";
import { calculateStatementBalances, LedgerAccountStatement } from "./LedgerAccountStatement";
import { LedgerAccountStatementRoutes } from "./LedgerAccountStatementRoutes";
import { StatementPersistenceFailure } from "./StatementErrors";
import {
	LedgerAccountStatementService,
	LedgerAccountStatementServiceTag,
} from "./LedgerAccountStatementService";

const orgId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const accountId = new TypeID("lat") as LedgerAccountID;
const statementId = new TypeID("lst") as LedgerAccountStatementID;
const prefix = `/api/ledgers/${ledgerId.toString()}/accounts/${accountId.toString()}/statements`;
const assetId = new TypeID("ast");
const request = {
	startDatetime: "2026-01-01T00:00:00.000Z",
	endDatetime: "2026-02-01T00:00:00.000Z",
	metadata: { period: "January" },
};
const balances = Effect.runSync(
	calculateStatementBalances("credit", {
		postedCredits: 20n,
		postedDebits: 5n,
		unpostedCredits: 8n,
		unpostedDebits: 4n,
	})
);
const stored = Effect.runSync(
	LedgerAccountStatement.fromRow({
		id: encodeUuid(statementId),
		organizationId: encodeUuid(orgId),
		ledgerId: encodeUuid(ledgerId),
		accountId: encodeUuid(accountId),
		startDatetime: new Date(request.startDatetime),
		endDatetime: new Date(request.endDatetime),
		ledgerAccountVersion: 7,
		snapshot: {
			normalBalance: "credit",
			assetId: encodeUuid(assetId),
			assetCode: "TOKENS",
			minorUnitExponent: 6,
			startingBalances: balances,
			endingBalances: balances,
		},
		description: "January",
		metadata: request.metadata,
		lockVersion: 2,
		created: new Date(request.endDatetime),
		updated: new Date(request.endDatetime),
	})
);
const makeService = () =>
	new LedgerAccountStatementService(
		{
			getStatement: vi.fn(() => Effect.succeed(stored)),
			createStatement: vi.fn(() => Effect.succeed(stored)),
			listStatements: vi.fn(() => Effect.succeed([stored])),
			getEntries: vi.fn(() => Effect.succeed([])),
			updateAnnotations: vi.fn(() => Effect.succeed(stored)),
		},
		{
			claim: vi.fn(() => Effect.succeed(Option.none())),
			complete: vi.fn(() => Effect.void),
			release: vi.fn(() => Effect.void),
		}
	);
const servers: FastifyInstance[] = [];
const buildRouteServer = async (service = makeService()) => {
	const server = fastify();
	const hasPermissions = vi.fn(() => async () => undefined);
	const runtime = new ServerRuntime(Layer.succeed(LedgerAccountStatementServiceTag, service));
	server.decorate("runtime", runtime as never);
	server.addHook("onClose", () => runtime.dispose());
	server.decorate("hasPermissions", hasPermissions);
	server.decorateRequest("token");
	server.addHook("preHandler", async req => {
		req.token = { orgId } as never;
	});
	server.setErrorHandler(globalErrorHandler);
	await server.register(fastifySwagger, {
		openapi: { info: { title: "Statements", version: "1" } },
	});
	await server.register(LedgerAccountStatementRoutes, {
		prefix: "/api/ledgers/:ledgerId/accounts/:accountId/statements",
	});
	await server.ready();
	servers.push(server);
	return { server, service, hasPermissions };
};
afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("Statement HTTP contract", () => {
	it("passes authenticated ownership and every path ID to scoped reads", async () => {
		const { server, service } = await buildRouteServer();
		const get = vi.spyOn(service, "getLedgerAccountStatement");
		const response = await server.inject({
			method: "GET",
			url: `${prefix}/${statementId.toString()}`,
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual(stored.toResponse());
		expect(get).toHaveBeenCalledWith(orgId, ledgerId, accountId, statementId);
		expect(response.json()).toMatchObject({
			assetId: assetId.toString(),
			assetCode: "TOKENS",
			minorUnitExponent: 6,
		});
		expect(response.json()).not.toHaveProperty("currencyCode");
		expect(response.json()).not.toHaveProperty("entries");
	});
	it("creates from path ownership and requires an idempotency key", async () => {
		const { server, service } = await buildRouteServer();
		const create = vi.spyOn(service, "createLedgerAccountStatement");
		const missingKey = await server.inject({ method: "POST", url: prefix, payload: request });
		expect(missingKey.statusCode).toBe(400);
		expect(create).not.toHaveBeenCalled();
		const response = await server.inject({
			method: "POST",
			url: prefix,
			headers: { "idempotency-key": "create" },
			payload: request,
		});
		expect(response.statusCode).toBe(200);
		expect(create).toHaveBeenCalledWith(orgId, ledgerId, accountId, "create", request);
	});
	it("returns arrays and forwards bounded pagination for both collections", async () => {
		const { server, service } = await buildRouteServer();
		const list = vi.spyOn(service, "listLedgerAccountStatements");
		const entries = vi.spyOn(service, "getLedgerAccountStatementEntries");
		const listed = await server.inject({ method: "GET", url: `${prefix}?offset=2&limit=3` });
		const savedEntries = await server.inject({
			method: "GET",
			url: `${prefix}/${statementId.toString()}/entries`,
		});
		expect(listed.statusCode).toBe(200);
		expect(listed.json()).toEqual([stored.toResponse()]);
		expect(savedEntries.statusCode).toBe(200);
		expect(savedEntries.json()).toEqual([]);
		expect(list).toHaveBeenCalledWith(orgId, ledgerId, accountId, { offset: 2, limit: 3 });
		expect(entries).toHaveBeenCalledWith(orgId, ledgerId, accountId, statementId, {
			offset: 0,
			limit: 20,
		});
		expect((await server.inject({ method: "GET", url: `${prefix}?limit=101` })).statusCode).toBe(400);
	});
	it("returns the repository's decoded Entries unchanged", async () => {
		const entry = {
			id: new TypeID("lte").toString(),
			accountId: accountId.toString(),
			direction: "credit" as const,
			amount: "5",
			assetId: assetId.toString(),
			assetCode: "TOKENS",
			minorUnitExponent: 6,
			created: request.startDatetime,
			transaction: {
				id: new TypeID("ltr").toString(),
				lockVersion: 1,
				status: "posted" as const,
				effectiveAt: request.startDatetime,
			},
		};
		const service = makeService();
		vi.spyOn(service, "getLedgerAccountStatementEntries").mockReturnValue(Effect.succeed([entry]));
		const { server } = await buildRouteServer(service);
		const response = await server.inject({
			method: "GET",
			url: `${prefix}/${statementId.toString()}/entries`,
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([entry]);
	});
	it("requires an expected annotation version and maps stale versions to conflict", async () => {
		const { server, service } = await buildRouteServer();
		const update = vi
			.spyOn(service, "updateLedgerAccountStatement")
			.mockReturnValue(Effect.fail(new ConflictError("Stale annotations")));
		expect(
			(
				await server.inject({
					method: "PUT",
					url: `${prefix}/${statementId.toString()}`,
					payload: { description: "reviewed" },
				})
			).statusCode
		).toBe(400);
		const response = await server.inject({
			method: "PUT",
			url: `${prefix}/${statementId.toString()}`,
			payload: { lockVersion: 1 },
		});
		expect(response.statusCode).toBe(409);
		expect(update).toHaveBeenCalledWith(orgId, ledgerId, accountId, statementId, { lockVersion: 1 });
	});
	it("validates ownership IDs and timestamps and hides unexpected failures", async () => {
		const { server, service } = await buildRouteServer();
		expect(
			(
				await server.inject({
					method: "GET",
					url: `/api/ledgers/invalid/accounts/${accountId.toString()}/statements`,
				})
			).statusCode
		).toBe(400);
		expect(
			(
				await server.inject({
					method: "POST",
					url: prefix,
					headers: { "idempotency-key": "invalid" },
					payload: { ...request, startDatetime: "yesterday" },
				})
			).statusCode
		).toBe(400);
		vi
			.spyOn(service, "getLedgerAccountStatement")
			.mockReturnValueOnce(Effect.fail(new NotFoundError("Statement not found")))
			.mockReturnValueOnce(
				Effect.fail(new StatementPersistenceFailure(new Error("private database details")))
			);
		expect(
			(await server.inject({ method: "GET", url: `${prefix}/${statementId.toString()}` })).statusCode
		).toBe(404);
		const failed = await server.inject({ method: "GET", url: `${prefix}/${statementId.toString()}` });
		expect(failed.statusCode).toBe(500);
		expect(failed.body).not.toContain("private database details");
	});
	it("documents all five operations with Statement read/write permissions", async () => {
		const { server, hasPermissions } = await buildRouteServer();
		expect(hasPermissions.mock.calls).toEqual([
			[["ledger:account:statement:read"]],
			[["ledger:account:statement:read"]],
			[["ledger:account:statement:read"]],
			[["ledger:account:statement:write"]],
			[["ledger:account:statement:write"]],
		]);
		const paths = server.swagger().paths;
		const root = "/api/ledgers/{ledgerId}/accounts/{accountId}/statements";
		expect(paths?.[`${root}/`]?.get?.operationId).toBe("listLedgerAccountStatements");
		expect(paths?.[`${root}/`]?.post?.operationId).toBe("createLedgerAccountStatement");
		expect(paths?.[`${root}/{statementId}`]?.get?.operationId).toBe("getLedgerAccountStatement");
		expect(paths?.[`${root}/{statementId}`]?.put?.operationId).toBe("updateLedgerAccountStatement");
		expect(paths?.[`${root}/{statementId}/entries`]?.get?.operationId).toBe(
			"getLedgerAccountStatementEntries"
		);
	});
	it("registers real routes behind authentication and write authorization", async () => {
		const server = await buildServer({
			runtimeLayer: Layer.merge(
				Layer.succeed(ServerConfigTag, new Config()),
				Layer.succeed(LedgerAccountStatementServiceTag, makeService())
			) as ServerRuntimeLayer,
		});
		servers.push(server);
		expect((await server.inject({ method: "GET", url: prefix })).statusCode).toBe(401);
		const token = signJWT({ sub: orgId.toString(), scope: ["org_readonly"] });
		expect(
			(
				await server.inject({
					method: "POST",
					url: prefix,
					headers: { authorization: `Bearer ${token}`, "idempotency-key": "forbidden" },
					payload: request,
				})
			).statusCode
		).toBe(403);
	});
});
