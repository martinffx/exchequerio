import fastifySwagger from "@fastify/swagger";
import { Effect, Layer } from "effect";
import fastify, { type FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalErrorHandler } from "@/lib/errors";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { ServerRuntime } from "@/runtime";
import { makeCurrency, makeMinorUnits } from "../domain/Currency";
import { Account } from "./domain/Account";
import { AccountHasDependents, AccountNotFound } from "./AccountErrors";
import { AccountRoutes } from "./AccountRoutes";
import type { AccountService } from "./AccountService";
import { AccountServiceTag } from "./AccountService";

const organizationId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const accountId = new TypeID("lat") as LedgerAccountID;
const account = new Account({
	id: accountId,
	organizationId,
	ledgerId,
	name: "Cash",
	description: "Operating cash",
	normalBalance: "debit",
	currency: makeCurrency("USD", 2),
	pendingAmount: makeMinorUnits(-5),
	postedAmount: makeMinorUnits(20),
	availableAmount: makeMinorUnits(15),
	pendingCredits: makeMinorUnits(10),
	pendingDebits: makeMinorUnits(5),
	postedCredits: makeMinorUnits(5),
	postedDebits: makeMinorUnits(25),
	availableCredits: makeMinorUnits(7),
	availableDebits: makeMinorUnits(22),
	lockVersion: 1,
	metadata: { externalId: "cash-42" },
	created: new Date("2026-08-09T10:00:00.000Z"),
	updated: new Date("2026-08-09T11:00:00.000Z"),
});

const service = (): AccountService =>
	vi.mocked<AccountService>({
		listAccounts: vi.fn(() => Effect.succeed([account])),
		getAccount: vi.fn(() => Effect.succeed(account)),
		createAccount: vi.fn(() => Effect.succeed(account)),
		updateAccount: vi.fn(() => Effect.succeed(account)),
		deleteAccount: vi.fn(() => Effect.succeed(account)),
	} as unknown as AccountService);

const servers: FastifyInstance[] = [];

const buildRouteServer = async (implementation: AccountService) => {
	const server = fastify();
	const hasPermissions = vi.fn(() => async () => undefined);
	server.setErrorHandler(globalErrorHandler);
	const runtime = new ServerRuntime(Layer.succeed(AccountServiceTag, implementation));
	server.decorate("runtime", runtime as never);
	server.decorateRequest("token");
	server.addHook("preHandler", async request => {
		request.token = {
			orgId: organizationId,
			organizationId,
			permissions: new Set(["ledger:account:read", "ledger:account:write", "ledger:account:delete"]),
		} as never;
	});
	server.decorate("hasPermissions", hasPermissions);
	await server.register(fastifySwagger, {
		openapi: { info: { title: "Account route test", version: "1" } },
	});
	await server.register(AccountRoutes, { prefix: "/api/ledgers/:ledgerId/accounts" });
	await server.ready();
	servers.push(server);
	return { server, hasPermissions };
};

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("AccountRoutes", () => {
	it("keeps the five existing permission declarations", async () => {
		const { hasPermissions } = await buildRouteServer(service());

		expect(hasPermissions.mock.calls).toEqual([
			[["ledger:account:read"]],
			[["ledger:account:read"]],
			[["ledger:account:write"]],
			[["ledger:account:write"]],
			[["ledger:account:delete"]],
		]);
	});

	it("returns Account-owned Currency once and forwards list pagination", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/${ledgerId.toString()}/accounts?offset=10&limit=5`,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject([
			{
				id: accountId.toString(),
				ledgerId: ledgerId.toString(),
				currencyCode: "USD",
				minorUnitExponent: 2,
				balances: [
					{ balanceType: "pending", amount: -5, credits: 10, debits: 5 },
					{ balanceType: "posted", amount: 20, credits: 5, debits: 25 },
					{ balanceType: "availableBalance", amount: 15, credits: 7, debits: 22 },
				],
			},
		]);
		expect(response.body).not.toContain('"currency":');
		expect(implementation.listAccounts).toHaveBeenCalledWith(organizationId, ledgerId, {
			offset: 10,
			limit: 5,
		});
	});

	it("requires create-only fields and returns 201 with Location", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const url = `/api/ledgers/${ledgerId.toString()}/accounts`;
		const response = await server.inject({
			method: "POST",
			url,
			payload: {
				name: "Cash",
				normalBalance: "debit",
				currencyCode: "US0378331005",
				minorUnitExponent: 4,
				ignored: true,
			},
		});

		expect(response.statusCode).toBe(201);
		expect(response.headers.location).toBe(`${url}/${accountId.toString()}`);
		expect(implementation.createAccount).toHaveBeenCalledWith(organizationId, ledgerId, {
			name: "Cash",
			normalBalance: "debit",
			currencyCode: "US0378331005",
			minorUnitExponent: 4,
		});

		const invalid = await server.inject({ method: "POST", url, payload: { name: "Cash" } });
		expect(invalid.statusCode).toBe(400);
	});

	it("strips immutable update fields", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const response = await server.inject({
			method: "PUT",
			url: `/api/ledgers/${ledgerId.toString()}/accounts/${accountId.toString()}`,
			payload: {
				name: "Operating Cash",
				normalBalance: "credit",
				currencyCode: "EUR",
				minorUnitExponent: 2,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(implementation.updateAccount).toHaveBeenCalledWith(organizationId, ledgerId, accountId, {
			name: "Operating Cash",
		});
	});

	it("deletes with an empty 204", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const response = await server.inject({
			method: "DELETE",
			url: `/api/ledgers/${ledgerId.toString()}/accounts/${accountId.toString()}`,
		});

		expect(response.statusCode).toBe(204);
		expect(response.body).toBe("");
		expect(implementation.deleteAccount).toHaveBeenCalledWith(organizationId, ledgerId, accountId);
	});

	it("rejects malformed IDs before invoking the service", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const response = await server.inject({
			method: "GET",
			url: "/api/ledgers/not-a-ledger/accounts/not-an-account",
		});

		expect(response.statusCode).toBe(400);
		expect(implementation.getAccount).not.toHaveBeenCalled();
	});

	it("maps typed not-found and dependency failures", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getAccount)
			.mockReturnValue(
				Effect.fail(
					new AccountNotFound(organizationId.toString(), ledgerId.toString(), accountId.toString())
				)
			);
		vi
			.mocked(implementation.deleteAccount)
			.mockReturnValue(
				Effect.fail(
					new AccountHasDependents(organizationId.toString(), ledgerId.toString(), accountId.toString())
				)
			);
		const { server } = await buildRouteServer(implementation);

		const get = await server.inject({
			method: "GET",
			url: `/api/ledgers/${ledgerId.toString()}/accounts/${accountId.toString()}`,
		});
		const remove = await server.inject({
			method: "DELETE",
			url: `/api/ledgers/${ledgerId.toString()}/accounts/${accountId.toString()}`,
		});
		expect(get.statusCode).toBe(404);
		expect(remove.statusCode).toBe(409);
	});

	it("advertises operation-specific failures without 429", async () => {
		const { server } = await buildRouteServer(service());
		const specification = JSON.stringify(server.swagger());

		expect(specification).toContain('"201"');
		expect(specification).toContain('"204"');
		expect(specification).toContain('"409"');
		expect(specification).not.toContain('"429"');
	});
});
