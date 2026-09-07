import fastifySwagger from "@fastify/swagger";
import { Effect, Layer, ManagedRuntime } from "effect";
import fastify, { type FastifyInstance } from "fastify";
import { Settings } from "luxon";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LedgerNotFound } from "@/domains/ledgers/LedgerErrors";
import { globalErrorHandler } from "@/lib/errors";
import type { LedgerAccountID, LedgerID, LedgerTransactionID, OrgID } from "@/lib/ids";
import { IdempotencyPending, IdempotencyUnavailable } from "@/services/IdempotencyService";

import { LedgerTransaction } from "./LedgerTransaction";
import {
	TransactionConcurrencyFailure,
	TransactionLifecycleConflict,
	TransactionNotFound,
	TransactionPersistenceDecodingFailure,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
} from "./LedgerTransactionErrors";
import { TransactionRoutes } from "./LedgerTransactionRoutes";
import type { TransactionService } from "./LedgerTransactionService";
import { TransactionServiceTag } from "./LedgerTransactionService";

const organizationId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const transactionId = new TypeID("ltr") as LedgerTransactionID;
const debitAccountId = new TypeID("lat") as LedgerAccountID;
const creditAccountId = new TypeID("lat") as LedgerAccountID;

const createBody = {
	status: "pending" as const,
	effectiveAt: "2026-08-01T09:00:00.000Z",
	description: "Transfer",
	ledgerEntries: [
		{
			accountId: debitAccountId.toString(),
			direction: "debit" as const,
			amount: 500,
			currencyCode: "EUR",
		},
		{
			accountId: creditAccountId.toString(),
			direction: "credit" as const,
			amount: 500,
			currencyCode: "EUR",
		},
	],
};

const transaction = (() => {
	const previousNow = Settings.now;
	Settings.now = () => Date.parse("2026-08-15T08:00:00.000Z");
	try {
		return Effect.runSync(
			LedgerTransaction.fromCreateRequest(transactionId, organizationId, ledgerId, createBody)
		);
	} finally {
		Settings.now = previousNow;
	}
})();

const updateBody = {
	effectiveAt: "2026-08-02T09:00:00.000Z",
	description: "Updated",
	ledgerEntries: createBody.ledgerEntries,
};

const service = (): TransactionService =>
	vi.mocked<TransactionService>({
		listTransactions: vi.fn(() => Effect.succeed([transaction])),
		getTransaction: vi.fn(() => Effect.succeed(transaction)),
		createTransaction: vi.fn(() => Effect.succeed(transaction)),
		updateTransaction: vi.fn(() => Effect.succeed(transaction)),
		postTransaction: vi.fn(() => Effect.succeed(transaction)),
		voidTransaction: vi.fn(() => Effect.succeed(transaction)),
	} as unknown as TransactionService);

const servers: FastifyInstance[] = [];

const buildRouteServer = async (implementation: TransactionService) => {
	const server = fastify();
	const hasPermissions = vi.fn(() => async () => undefined);
	server.setErrorHandler(globalErrorHandler);
	const runtime = ManagedRuntime.make(Layer.succeed(TransactionServiceTag, implementation));
	server.decorate("runtime", runtime as never);
	server.decorateRequest("token");
	server.addHook("preHandler", async request => {
		request.token = {
			orgId: organizationId,
			organizationId,
			permissions: new Set([
				"ledger:transaction:read",
				"ledger:transaction:write",
				"ledger:transaction:delete",
			]),
		} as never;
	});
	server.decorate("hasPermissions", hasPermissions);
	await server.register(fastifySwagger, {
		openapi: { info: { title: "Transaction route test", version: "1" } },
	});
	await server.register(TransactionRoutes, { prefix: "/api/ledgers/:ledgerId/transactions" });
	await server.ready();
	servers.push(server);
	return { server, hasPermissions };
};

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("TransactionRoutes", () => {
	it("keeps the six existing permission declarations", async () => {
		const { hasPermissions } = await buildRouteServer(service());

		expect(hasPermissions.mock.calls).toEqual([
			[["ledger:transaction:read"]],
			[["ledger:transaction:read"]],
			[["ledger:transaction:write"]],
			[["ledger:transaction:write"]],
			[["ledger:transaction:write"]],
			[["ledger:transaction:delete"]],
		]);
	});

	it("omits Entries from the list response", async () => {
		const { server } = await buildRouteServer(service());
		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/${ledgerId.toString()}/transactions`,
		});

		expect(response.statusCode).toBe(200);
		const [item] = response.json<Array<Record<string, unknown>>>();
		expect(item).not.toHaveProperty("ledgerEntries");
		expect(item).toHaveProperty("effectiveAt", createBody.effectiveAt);
	});

	it.each([
		["list", "GET", "", undefined, undefined, 200],
		["get", "GET", `/${transactionId.toString()}`, undefined, undefined, 200],
		["create", "POST", "", createBody, { "idempotency-key": "create-42" }, 201],
		[
			"update",
			"PUT",
			`/${transactionId.toString()}`,
			updateBody,
			{ "idempotency-key": "update-42" },
			200,
		],
		[
			"post",
			"POST",
			`/${transactionId.toString()}/post`,
			undefined,
			{ "idempotency-key": "post-42" },
			200,
		],
		[
			"void",
			"DELETE",
			`/${transactionId.toString()}`,
			undefined,
			{ "idempotency-key": "void-42" },
			204,
		],
	] as const)(
		"serves %s through the mock Effect service",
		async (_name, method, suffix, payload, headers, status) => {
			const { server } = await buildRouteServer(service());
			const response = await server.inject({
				method,
				url: `/api/ledgers/${ledgerId.toString()}/transactions${suffix}`,
				...(payload === undefined ? {} : { payload }),
				...(headers === undefined ? {} : { headers }),
			});

			expect(response.statusCode).toBe(status);
			if (status === 204) expect(response.body).toBe("");
			else
				expect(response.json()).toEqual(
					status === 200 && suffix === "" ? [expect.any(Object)] : expect.any(Object)
				);
		}
	);

	it("passes canonical tenant scope, defaults, header, and update input", async () => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);

		await server.inject({ method: "GET", url: `/api/ledgers/${ledgerId.toString()}/transactions` });
		await server.inject({
			method: "POST",
			url: `/api/ledgers/${ledgerId.toString()}/transactions`,
			headers: { "idempotency-key": "create-42" },
			payload: { ...createBody, ignored: true },
		});
		await server.inject({
			method: "PUT",
			url: `/api/ledgers/${ledgerId.toString()}/transactions/${transactionId.toString()}`,
			headers: { "idempotency-key": "update-42" },
			payload: { ...updateBody, ignored: true },
		});
		await server.inject({
			method: "GET",
			url: `/api/ledgers/${ledgerId.toString()}/transactions/${transactionId.toString()}`,
		});
		await server.inject({
			method: "POST",
			url: `/api/ledgers/${ledgerId.toString()}/transactions/${transactionId.toString()}/post`,
			headers: { "idempotency-key": "post-42" },
		});
		await server.inject({
			method: "DELETE",
			url: `/api/ledgers/${ledgerId.toString()}/transactions/${transactionId.toString()}`,
			headers: { "idempotency-key": "void-42" },
		});

		expect(implementation.listTransactions).toHaveBeenCalledWith(organizationId, ledgerId, {
			offset: 0,
			limit: 20,
		});
		expect(implementation.createTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			"create-42",
			createBody
		);
		expect(implementation.updateTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			transactionId,
			"update-42",
			updateBody
		);
		expect(implementation.getTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			transactionId
		);
		expect(implementation.postTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			transactionId,
			"post-42"
		);
		expect(implementation.voidTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			transactionId,
			"void-42"
		);
	});

	it("returns create Location and omits absent optional response fields", async () => {
		const { server } = await buildRouteServer(service());
		const response = await server.inject({
			method: "POST",
			url: `/api/ledgers/${ledgerId.toString()}/transactions`,
			headers: { "idempotency-key": "create-42" },
			payload: createBody,
		});

		expect(response.statusCode).toBe(201);
		expect(response.headers.location).toBe(
			`/api/ledgers/${ledgerId.toString()}/transactions/${transactionId.toString()}`
		);
		expect(response.json()).toMatchObject({
			id: transactionId.toString(),
			ledgerId: ledgerId.toString(),
			status: "pending",
			description: "Transfer",
			created: "2026-08-15T08:00:00.000Z",
			updated: "2026-08-15T08:00:00.000Z",
		});
		expect(response.json()).not.toHaveProperty("metadata");
		expect(response.json()).not.toHaveProperty("postedAt");
	});

	it.each([
		["malformed Ledger ID", "GET", "/api/ledgers/nope/transactions", undefined, undefined],
		[
			"noncanonical Transaction ID",
			"GET",
			`/api/ledgers/${ledgerId.toString()}/transactions/${transactionId.toString().toUpperCase()}`,
			undefined,
			undefined,
		],
		[
			"invalid pagination",
			"GET",
			`/api/ledgers/${ledgerId.toString()}/transactions?limit=101`,
			undefined,
			undefined,
		],
		[
			"missing idempotency header",
			"POST",
			`/api/ledgers/${ledgerId.toString()}/transactions`,
			createBody,
			undefined,
		],
		[
			"invalid request body",
			"POST",
			`/api/ledgers/${ledgerId.toString()}/transactions`,
			{ ...createBody, ledgerEntries: [] },
			{ "idempotency-key": "create-42" },
		],
		[
			"invalid effective time",
			"POST",
			`/api/ledgers/${ledgerId.toString()}/transactions`,
			{ ...createBody, effectiveAt: "not-a-date" },
			{ "idempotency-key": "create-42" },
		],
	] as const)("rejects %s before the service", async (_name, method, url, payload, headers) => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const response = await server.inject({
			method,
			url,
			...(payload === undefined ? {} : { payload }),
			...(headers === undefined ? {} : { headers }),
		});

		expect(response.statusCode).toBe(400);
		expect(implementation.createTransaction).not.toHaveBeenCalled();
	});

	it.each([
		["create", "POST", "", createBody],
		["update", "PUT", `/${transactionId.toString()}`, updateBody],
	] as const)(
		"rejects unsupported effective times on %s before the service",
		async (_name, method, suffix, body) => {
			const implementation = service();
			const { server } = await buildRouteServer(implementation);
			for (const effectiveAt of ["2026-09-06 12:00:00Z", "2026-12-31T23:59:60Z"]) {
				const response = await server.inject({
					method,
					url: `/api/ledgers/${ledgerId.toString()}/transactions${suffix}`,
					headers: { "idempotency-key": crypto.randomUUID() },
					payload: { ...body, effectiveAt },
				});
				expect(response.statusCode).toBe(400);
			}
			expect(implementation.createTransaction).not.toHaveBeenCalled();
			expect(implementation.updateTransaction).not.toHaveBeenCalled();
		}
	);

	it.each([
		["create", "POST", "", createBody],
		["update", "PUT", `/${transactionId.toString()}`, updateBody],
	] as const)("accepts supported effective times on %s", async (_name, method, suffix, body) => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		for (const effectiveAt of [
			"2026-09-06T12:00:00+02:00",
			"2026-09-06T12:00:00.123456Z",
			"2026-09-06t12:00:00z",
		]) {
			const key = crypto.randomUUID();
			const payload = { ...body, effectiveAt };
			const response = await server.inject({
				method,
				url: `/api/ledgers/${ledgerId.toString()}/transactions${suffix}`,
				headers: { "idempotency-key": key },
				payload,
			});
			expect(response.statusCode).toBe(method === "POST" ? 201 : 200);
			if (method === "POST") {
				expect(implementation.createTransaction).toHaveBeenLastCalledWith(
					organizationId,
					ledgerId,
					key,
					payload
				);
			} else {
				expect(implementation.updateTransaction).toHaveBeenLastCalledWith(
					organizationId,
					ledgerId,
					transactionId,
					key,
					payload
				);
			}
		}
	});

	it.each([
		["create", "POST", "", { "idempotency-key": "create-42" }],
		["update", "PUT", `/${transactionId.toString()}`, { "idempotency-key": "update-42" }],
	] as const)("limits %s requests to 200 Entries", async (_name, method, suffix, headers) => {
		const implementation = service();
		const { server } = await buildRouteServer(implementation);
		const ledgerEntries = Array.from({ length: 201 }, (_, index) => ({
			...createBody.ledgerEntries[index % 2],
		}));
		const accepted = await server.inject({
			method,
			url: `/api/ledgers/${ledgerId.toString()}/transactions${suffix}`,
			payload: { ...createBody, ledgerEntries: ledgerEntries.slice(0, 200) },
			...(headers === undefined ? {} : { headers }),
		});
		const response = await server.inject({
			method,
			url: `/api/ledgers/${ledgerId.toString()}/transactions${suffix}`,
			payload: { ...createBody, ledgerEntries },
			...(headers === undefined ? {} : { headers }),
		});

		expect(accepted.statusCode).toBe(method === "POST" ? 201 : 200);
		expect(response.statusCode).toBe(400);
		expect(
			method === "POST" ? implementation.createTransaction : implementation.updateTransaction
		).toHaveBeenCalledOnce();
	});

	it.each([
		["list", "listTransactions", "GET", "", undefined, undefined, new LedgerNotFound(), 404],
		[
			"get",
			"getTransaction",
			"GET",
			`/${transactionId.toString()}`,
			undefined,
			undefined,
			new TransactionNotFound(),
			404,
		],
		[
			"create validation",
			"createTransaction",
			"POST",
			"",
			createBody,
			{ "idempotency-key": "create-42" },
			new TransactionValidationFailure("invalid"),
			400,
		],
		[
			"create availability",
			"createTransaction",
			"POST",
			"",
			createBody,
			{ "idempotency-key": "create-42" },
			new IdempotencyUnavailable(new Error("offline")),
			503,
		],
		[
			"create pending",
			"createTransaction",
			"POST",
			"",
			createBody,
			{ "idempotency-key": "create-42" },
			new IdempotencyPending(),
			409,
		],
		[
			"update concurrency",
			"updateTransaction",
			"PUT",
			`/${transactionId.toString()}`,
			updateBody,
			{ "idempotency-key": "update-42" },
			new TransactionConcurrencyFailure(new Error("race")),
			409,
		],
		[
			"post lifecycle",
			"postTransaction",
			"POST",
			`/${transactionId.toString()}/post`,
			undefined,
			{ "idempotency-key": "post-42" },
			new TransactionLifecycleConflict("voided", "posted"),
			409,
		],
		[
			"void repository",
			"voidTransaction",
			"DELETE",
			`/${transactionId.toString()}`,
			undefined,
			{ "idempotency-key": "void-42" },
			new TransactionRepositoryUnavailable(new Error("offline")),
			503,
		],
		[
			"decoding",
			"getTransaction",
			"GET",
			`/${transactionId.toString()}`,
			undefined,
			undefined,
			new TransactionPersistenceDecodingFailure(new Error("bad row")),
			500,
		],
	] as const)(
		"maps the %s service failure",
		async (_name, methodName, method, suffix, payload, headers, error, status) => {
			const implementation = service();
			vi.mocked(implementation[methodName]).mockReturnValue(Effect.fail(error) as never);
			const { server } = await buildRouteServer(implementation);
			const response = await server.inject({
				method,
				url: `/api/ledgers/${ledgerId.toString()}/transactions${suffix}`,
				...(payload === undefined ? {} : { payload }),
				...(headers === undefined ? {} : { headers }),
			});

			expect(response.statusCode).toBe(status);
		}
	);

	it("marks a pending Transaction response as retryable after one second", async () => {
		const implementation = service();
		vi
			.mocked(implementation.createTransaction)
			.mockReturnValue(Effect.fail(new IdempotencyPending()));
		const { server } = await buildRouteServer(implementation);
		const response = await server.inject({
			method: "POST",
			url: `/api/ledgers/${ledgerId.toString()}/transactions`,
			headers: { "idempotency-key": "create-42" },
			payload: createBody,
		});

		expect(response.statusCode).toBe(409);
		expect(response.headers["retry-after"]).toBe("1");
		expect(response.json()).toMatchObject({ type: "CONFLICT", retryable: true });
	});

	it("advertises only operation-specific failures", async () => {
		const { server } = await buildRouteServer(service());
		const specification = JSON.stringify(server.swagger());

		expect(specification).toContain('"createLedgerTransaction"');
		expect(server.swagger()).toMatchObject({
			paths: {
				"/api/ledgers/{ledgerId}/transactions/": {
					get: { responses: { 200: {}, 404: {} } },
					post: { responses: { 201: {}, 404: {}, 409: {}, 503: {} } },
				},
				"/api/ledgers/{ledgerId}/transactions/{transactionId}": {
					get: { responses: { 200: {}, 404: {} } },
					put: { responses: { 200: {}, 404: {}, 409: {} } },
					delete: { responses: { 204: {}, 404: {}, 409: {} } },
				},
				"/api/ledgers/{ledgerId}/transactions/{transactionId}/post": {
					post: { responses: { 200: {}, 404: {}, 409: {} } },
				},
			},
		});
		expect(server.swagger()).not.toMatchObject({
			paths: {
				"/api/ledgers/{ledgerId}/transactions/": { get: { responses: { 409: {} } } },
				"/api/ledgers/{ledgerId}/transactions/{transactionId}": {
					get: { responses: { 409: {} } },
				},
			},
		});
		expect(specification).not.toContain('"429"');
	});
});
