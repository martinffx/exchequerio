import fastifySwagger from "@fastify/swagger";
import { Effect, Layer } from "effect";
import fastify, { type FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { signJWT } from "@/auth";
import { ConflictError, globalErrorHandler, NotFoundError } from "@/lib/errors";
import type {
	LedgerAccountID,
	LedgerAccountStatementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import { ServerRuntime } from "@/runtime";
import { buildServer } from "@/server";

import { LedgerAccountStatement } from "./LedgerAccountStatement";
import { LedgerAccountStatementRoutes } from "./LedgerAccountStatementRoutes";
import type { LedgerAccountStatementService } from "./LedgerAccountStatementService";
import { LedgerAccountStatementServiceTag } from "./LedgerAccountStatementService";

const ledgerId = TypeID.fromString<"lgr">("lgr_01h2x3y4z5a6b7c8d9e0f1g2h4") as LedgerID;
const pathAccountId = TypeID.fromString<"lat">("lat_01h2x3y4z5a6b7c8d9e0f1g2h6") as LedgerAccountID;
const bodyAccountId = TypeID.fromString<"lat">("lat_01h2x3y4z5a6b7c8d9e0f1g2h8") as LedgerAccountID;
const statementId = TypeID.fromString<"lst">(
	"lst_01h2x3y4z5a6b7c8d9e0f1g2h5"
) as LedgerAccountStatementID;
const fixedDate = new Date("2025-01-01T00:00:00.000Z");
const orgId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;

const statement = new LedgerAccountStatement({
	id: statementId,
	ledgerId,
	accountId: bodyAccountId,
	statementDate: fixedDate,
	openingBalance: 0,
	closingBalance: 0,
	totalCredits: 0,
	totalDebits: 0,
	transactionCount: 0,
	created: fixedDate,
	updated: fixedDate,
});

const service = (): LedgerAccountStatementService =>
	vi.mocked<LedgerAccountStatementService>({
		getLedgerAccountStatement: vi.fn(() => Effect.succeed(statement)),
		createLedgerAccountStatement: vi.fn(() => Effect.succeed(statement)),
	} as unknown as LedgerAccountStatementService);

const servers: FastifyInstance[] = [];

const buildRouteServer = async (implementation: LedgerAccountStatementService) => {
	const server = fastify();
	const hasPermissions = vi.fn(() => async () => undefined);
	server.setErrorHandler(globalErrorHandler);
	const runtime = new ServerRuntime(Layer.succeed(LedgerAccountStatementServiceTag, implementation));
	server.decorate("runtime", runtime as never);
	server.decorate("hasPermissions", hasPermissions);
	await server.register(fastifySwagger, {
		openapi: { info: { title: "Statement route test", version: "1" } },
	});
	await server.register(LedgerAccountStatementRoutes, {
		prefix: "/api/ledgers/:ledgerId/accounts/:accountId/statements",
	});
	await server.ready();
	servers.push(server);
	return { server, runtime, hasPermissions };
};

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("LedgerAccountStatementRoutes", () => {
	it("preserves the existing permission declarations", async () => {
		const { hasPermissions } = await buildRouteServer(service());

		expect(hasPermissions.mock.calls).toEqual([
			[["ledger:account:statement:read"]],
			[["ledger:account:statement:write"]],
		]);
	});

	it("gets by statement ID alone through one Effect runtime crossing", async () => {
		const implementation = service();
		const { server, runtime } = await buildRouteServer(implementation);
		const runPromise = vi.spyOn(runtime, "runPromise");

		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/${new TypeID("lgr").toString()}/accounts/${pathAccountId.toString()}/statements/${statementId.toString()}`,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual(statement.toResponse());
		expect(implementation.getLedgerAccountStatement).toHaveBeenCalledWith(statementId.toString());
		expect(runPromise).toHaveBeenCalledOnce();
	});

	it("creates from the body and ignores the enclosing path IDs", async () => {
		const implementation = service();
		const { server, runtime } = await buildRouteServer(implementation);
		const runPromise = vi.spyOn(runtime, "runPromise");
		const request = {
			ledgerId: ledgerId.toString(),
			accountId: bodyAccountId.toString(),
			description: "Test statement",
			startDatetime: fixedDate.toISOString(),
			endDatetime: "2025-02-01T00:00:00.000Z",
		};

		const response = await server.inject({
			method: "POST",
			url: `/api/ledgers/${new TypeID("lgr").toString()}/accounts/${pathAccountId.toString()}/statements`,
			payload: request,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual(statement.toResponse());
		expect(implementation.createLedgerAccountStatement).toHaveBeenCalledWith(request);
		expect(runPromise).toHaveBeenCalledOnce();
	});

	it("preserves metadata key-value pairs on the wire", async () => {
		const implementation = service();
		vi.mocked(implementation.getLedgerAccountStatement).mockReturnValue(
			Effect.succeed(
				new LedgerAccountStatement({
					...statement,
					metadata: { period: "monthly" },
				})
			)
		);
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/${ledgerId.toString()}/accounts/${pathAccountId.toString()}/statements/${statementId.toString()}`,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json<{ metadata?: Record<string, string> }>().metadata).toEqual({
			period: "monthly",
		});
	});

	it("registers the production GET route behind authentication", async () => {
		const server = await buildServer();
		servers.push(server);

		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/${ledgerId.toString()}/accounts/${pathAccountId.toString()}/statements/${statementId.toString()}`,
		});

		expect(response.statusCode).toBe(401);
	});

	it("registers the production POST route with write permission", async () => {
		const server = await buildServer();
		servers.push(server);
		const tokenReadOnly = signJWT({
			sub: orgId.toString(),
			scope: ["org_readonly"],
		});

		const response = await server.inject({
			method: "POST",
			headers: { Authorization: `Bearer ${tokenReadOnly}` },
			url: `/api/ledgers/${ledgerId.toString()}/accounts/${pathAccountId.toString()}/statements`,
			payload: {
				ledgerId: ledgerId.toString(),
				accountId: bodyAccountId.toString(),
				startDatetime: fixedDate.toISOString(),
				endDatetime: "2025-02-01T00:00:00.000Z",
			},
		});

		expect(response.statusCode).toBe(403);
	});

	it("keeps validation and typed failure responses", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getLedgerAccountStatement)
			.mockReturnValue(Effect.fail(new NotFoundError("Statement not found")));
		vi
			.mocked(implementation.createLedgerAccountStatement)
			.mockReturnValue(Effect.fail(new ConflictError("Statement already exists")));
		const { server } = await buildRouteServer(implementation);
		const prefix = `/api/ledgers/${ledgerId.toString()}/accounts/${pathAccountId.toString()}/statements`;

		const invalid = await server.inject({ method: "GET", url: `${prefix}/invalid` });
		const missing = await server.inject({
			method: "GET",
			url: `${prefix}/${statementId.toString()}`,
		});
		const conflict = await server.inject({
			method: "POST",
			url: prefix,
			payload: {
				ledgerId: ledgerId.toString(),
				accountId: bodyAccountId.toString(),
				startDatetime: fixedDate.toISOString(),
				endDatetime: fixedDate.toISOString(),
			},
		});

		expect(invalid.statusCode).toBe(400);
		expect(missing.statusCode).toBe(404);
		expect(conflict.statusCode).toBe(409);
	});

	it("sanitizes unexpected service failures", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getLedgerAccountStatement)
			.mockReturnValue(Effect.fail(new Error("database details")));
		const { server } = await buildRouteServer(implementation);

		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/${ledgerId.toString()}/accounts/${pathAccountId.toString()}/statements/${statementId.toString()}`,
		});

		expect(response.statusCode).toBe(500);
		expect(response.json()).toMatchObject({
			type: "INTERNAL_SERVER_ERROR",
			status: 500,
			detail: "Internal Server Error",
		});
		expect(response.body).not.toContain("database details");
	});

	it("preserves the existing OpenAPI operations and response sets", async () => {
		const { server } = await buildRouteServer(service());
		const specification = server.swagger();
		const paths = specification.paths;
		const path = paths?.["/api/ledgers/{ledgerId}/accounts/{accountId}/statements/{statementId}"];
		const collection = paths?.["/api/ledgers/{ledgerId}/accounts/{accountId}/statements/"];

		expect({
			get: path?.get,
			post: collection?.post,
		}).toMatchSnapshot();

		expect(path?.get).toMatchObject({
			operationId: "getLedgerAccountStatement",
			tags: ["Ledger Account Statements"],
			summary: "Get Ledger Account Statement",
			description: "Get Ledger Account Statement",
		});
		expect(Object.keys(path?.get?.responses ?? {})).toEqual([
			"200",
			"400",
			"401",
			"403",
			"404",
			"429",
			"500",
			"503",
		]);
		expect(collection?.post).toMatchObject({
			operationId: "createLedgerAccountStatement",
			tags: ["Ledger Account Statements"],
			summary: "Create Ledger Account Statement",
			description: "Create Ledger Account Statement",
		});
		expect(Object.keys(collection?.post?.responses ?? {})).toEqual([
			"200",
			"400",
			"401",
			"403",
			"409",
			"429",
			"500",
			"503",
		]);
	});
});
