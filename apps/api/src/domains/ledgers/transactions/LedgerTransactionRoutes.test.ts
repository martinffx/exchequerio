import { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { Settings } from "luxon";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LedgerApi } from "@/api";
import { signJWT } from "@/auth";
import { LedgerNotFound } from "@/domains/ledgers/LedgerErrors";
import type { LedgerAccountID, LedgerID, LedgerTransactionID, OrgID } from "@/lib/ids";
import { IdempotencyPending, IdempotencyUnavailable } from "@/lib/IdempotencyService";
import { makeTestWebHandler } from "@/server";

import { LedgerTransaction } from "./LedgerTransaction";
import {
	TransactionConcurrencyFailure,
	TransactionLifecycleConflict,
	TransactionNotFound,
	TransactionPersistenceDecodingFailure,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
} from "./LedgerTransactionErrors";
import type { TransactionService } from "./LedgerTransactionService";

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
			amount: "500",
			assetCode: "EUR",
		},
		{
			accountId: creditAccountId.toString(),
			direction: "credit" as const,
			amount: "500",
			assetCode: "EUR",
		},
	],
};

const transaction = (() => {
	const previousNow = Settings.now;
	Settings.now = () => Date.parse("2026-08-15T08:00:00.000Z");
	try {
		return Effect.runSync(
			LedgerTransaction.fromCreateRequest(transactionId, organizationId, ledgerId, {
				...createBody,
				ledgerEntries: createBody.ledgerEntries.map(entry => ({
					...entry,
					assetId: "ast_00000000000000000000000001",
					minorUnitExponent: 2,
				})),
			})
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

const disposers: Array<() => Promise<void>> = [];

const build = (implementation: TransactionService) => {
	const { handler, dispose } = makeTestWebHandler({ transaction: implementation });
	disposers.push(dispose);
	return handler;
};

const tokenWith = (scope: Parameters<typeof signJWT>[0]["scope"]) =>
	signJWT({ sub: organizationId.toString(), scope });
const request = (
	method: string,
	path: string,
	options: {
		token?: string;
		anonymous?: boolean;
		body?: unknown;
		headers?: Record<string, string>;
	} = {}
) => {
	const token =
		options.anonymous === true ? undefined : (options.token ?? tokenWith(["super_admin"]));
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
			...(options.body === undefined ? {} : { "content-type": "application/json" }),
			...options.headers,
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
};

afterEach(async () => {
	for (const dispose of disposers.splice(0)) await dispose();
});

const collectionPath = `/api/ledgers/${ledgerId.toString()}/transactions`;
const itemPath = `${collectionPath}/${transactionId.toString()}`;
const postPath = `${itemPath}/post`;
const key = (value: string) => ({ "idempotency-key": value });
const routes: Array<[string, string, string, unknown, Record<string, string>]> = [
	["GET", collectionPath, "ledger:transaction:read", undefined, {}],
	["GET", itemPath, "ledger:transaction:read", undefined, {}],
	["POST", collectionPath, "ledger:transaction:write", createBody, key("create-42")],
	["PUT", itemPath, "ledger:transaction:write", updateBody, key("update-42")],
	["POST", postPath, "ledger:transaction:write", undefined, key("post-42")],
	["DELETE", itemPath, "ledger:transaction:delete", undefined, key("void-42")],
];

describe("TransactionRoutes", () => {
	it("omits Entries from the list response and forwards default pagination", async () => {
		const implementation = service();
		const response = await build(implementation)(request("GET", collectionPath));

		expect(response.status).toBe(200);
		const [item] = (await response.json()) as Array<Record<string, unknown>>;
		expect(item).not.toHaveProperty("ledgerEntries");
		expect(item).toHaveProperty("effectiveAt", createBody.effectiveAt);
		expect(implementation.listTransactions).toHaveBeenCalledWith(organizationId, ledgerId, {
			offset: 0,
			limit: 20,
		});
	});

	it.each(routes.map(([method, path, , body, headers]) => [method, path, body, headers] as const))(
		"serves %s %s through the stubbed service",
		async (method, path, body, headers) => {
			const response = await build(service())(request(method, path, { body, headers }));

			expect(response.status).toBe(
				method === "DELETE" ? 204 : method === "POST" && path === collectionPath ? 201 : 200
			);
			if (method === "DELETE") expect(await response.text()).toBe("");
			else
				expect(await response.json()).toEqual(
					path === collectionPath && method === "GET" ? [expect.any(Object)] : expect.any(Object)
				);
		}
	);

	it("passes canonical tenant scope, header, and input to the service", async () => {
		const implementation = service();
		const handler = build(implementation);

		await handler(request("POST", collectionPath, { body: createBody, headers: key("create-42") }));
		await handler(request("PUT", itemPath, { body: updateBody, headers: key("update-42") }));
		await handler(request("GET", itemPath));
		await handler(request("POST", postPath, { headers: key("post-42") }));
		await handler(request("DELETE", itemPath, { headers: key("void-42") }));

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
		const response = await build(service())(
			request("POST", collectionPath, { body: createBody, headers: key("create-42") })
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("location")).toBe(itemPath);
		const json = await response.json();
		expect(json).toMatchObject({
			id: transactionId.toString(),
			ledgerId: ledgerId.toString(),
			status: "pending",
			description: "Transfer",
			created: "2026-08-15T08:00:00.000Z",
			updated: "2026-08-15T08:00:00.000Z",
		});
		expect(json).not.toHaveProperty("metadata");
		expect(json).not.toHaveProperty("postedAt");
	});

	it.each([
		["malformed Ledger ID", "GET", "/api/ledgers/nope/transactions", undefined, {}],
		[
			"noncanonical Transaction ID",
			"GET",
			`${collectionPath}/${transactionId.toString().toUpperCase()}`,
			undefined,
			{},
		],
		["invalid pagination", "GET", `${collectionPath}?limit=101`, undefined, {}],
		["missing idempotency header", "POST", collectionPath, createBody, {}],
		["missing idempotency header on post", "POST", postPath, undefined, {}],
		["missing idempotency header on void", "DELETE", itemPath, undefined, {}],
		[
			"invalid request body",
			"POST",
			collectionPath,
			{ ...createBody, ledgerEntries: [] },
			key("create-42"),
		],
		[
			"invalid effective time",
			"POST",
			collectionPath,
			{ ...createBody, effectiveAt: "not-a-date" },
			key("create-42"),
		],
	] as const)("rejects %s before the service", async (_name, method, url, body, headers) => {
		const implementation = service();
		const response = await build(implementation)(request(method, url, { body, headers }));

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
		expect(implementation.createTransaction).not.toHaveBeenCalled();
		expect(implementation.postTransaction).not.toHaveBeenCalled();
		expect(implementation.voidTransaction).not.toHaveBeenCalled();
	});

	it.each([
		["create", "POST", collectionPath, createBody],
		["update", "PUT", itemPath, updateBody],
	] as const)(
		"rejects unsupported effective times on %s before the service",
		async (_name, method, path, body) => {
			const implementation = service();
			const handler = build(implementation);
			for (const effectiveAt of ["2026-09-06 12:00:00Z", "2026-12-31T23:59:60Z"]) {
				const response = await handler(
					request(method, path, {
						headers: key(crypto.randomUUID()),
						body: { ...body, effectiveAt },
					})
				);
				expect(response.status).toBe(400);
			}
			expect(implementation.createTransaction).not.toHaveBeenCalled();
			expect(implementation.updateTransaction).not.toHaveBeenCalled();
		}
	);

	it.each([
		["create", "POST", collectionPath, createBody],
		["update", "PUT", itemPath, updateBody],
	] as const)("accepts supported effective times on %s", async (_name, method, path, body) => {
		const implementation = service();
		const handler = build(implementation);
		for (const effectiveAt of [
			"2026-09-06T12:00:00+02:00",
			"2026-09-06T12:00:00.123456Z",
			"2026-09-06t12:00:00z",
		]) {
			const idempotencyKey = crypto.randomUUID();
			const payload = { ...body, effectiveAt };
			const response = await handler(
				request(method, path, { headers: key(idempotencyKey), body: payload })
			);
			expect(response.status).toBe(method === "POST" ? 201 : 200);
			if (method === "POST") {
				expect(implementation.createTransaction).toHaveBeenLastCalledWith(
					organizationId,
					ledgerId,
					idempotencyKey,
					payload
				);
			} else {
				expect(implementation.updateTransaction).toHaveBeenLastCalledWith(
					organizationId,
					ledgerId,
					transactionId,
					idempotencyKey,
					payload
				);
			}
		}
	});

	it.each([
		"2026-09-06T12:00:00",
		"2026-09-06T12:00:00.123",
		"2026-02-30T12:00:00Z",
		"2026-02-29T12:00:00Z",
		"+002026-09-06T12:00:00Z",
		"2026-09-06T24:00:00Z",
	])("rejects effective time %s before the service", async effectiveAt => {
		const implementation = service();
		const response = await build(implementation)(
			request("POST", collectionPath, {
				headers: key("date-time"),
				body: { ...createBody, effectiveAt },
			})
		);
		expect(response.status).toBe(400);
		for (const method of Object.values(implementation)) expect(method).not.toHaveBeenCalled();
	});

	it.each([
		"2026-09-06T12:00:00+02",
		"2026-09-06T12:00:00+02:00",
		"2026-09-06T12:00:00.123Z",
		"2028-02-29T12:00:00Z",
	])("accepts effective time %s", async effectiveAt => {
		const implementation = service();
		const response = await build(implementation)(
			request("POST", collectionPath, {
				headers: key("date-time"),
				body: { ...createBody, effectiveAt },
			})
		);
		expect(response.status).toBe(201);
		expect(implementation.createTransaction).toHaveBeenCalledOnce();
	});

	it.each([
		["create", "POST", collectionPath, createBody],
		["update", "PUT", itemPath, updateBody],
	] as const)("limits %s requests to 200 Entries", async (_name, method, path, body) => {
		const implementation = service();
		const handler = build(implementation);
		const ledgerEntries = Array.from({ length: 201 }, (_, index) => ({
			...createBody.ledgerEntries[index % 2],
		}));
		const accepted = await handler(
			request(method, path, {
				headers: key("k"),
				body: { ...body, ledgerEntries: ledgerEntries.slice(0, 200) },
			})
		);
		const rejected = await handler(
			request(method, path, { headers: key("k"), body: { ...body, ledgerEntries } })
		);

		expect(accepted.status).toBe(method === "POST" ? 201 : 200);
		expect(rejected.status).toBe(400);
		expect(
			method === "POST" ? implementation.createTransaction : implementation.updateTransaction
		).toHaveBeenCalledOnce();
	});

	it.each([
		["list", "listTransactions", "GET", collectionPath, undefined, {}, new LedgerNotFound(), 404],
		["get", "getTransaction", "GET", itemPath, undefined, {}, new TransactionNotFound(), 404],
		[
			"create validation",
			"createTransaction",
			"POST",
			collectionPath,
			createBody,
			key("create-42"),
			new TransactionValidationFailure("invalid"),
			400,
		],
		[
			"create availability",
			"createTransaction",
			"POST",
			collectionPath,
			createBody,
			key("create-42"),
			new IdempotencyUnavailable(new Error("offline")),
			503,
		],
		[
			"create pending",
			"createTransaction",
			"POST",
			collectionPath,
			createBody,
			key("create-42"),
			new IdempotencyPending(),
			409,
		],
		[
			"update concurrency",
			"updateTransaction",
			"PUT",
			itemPath,
			updateBody,
			key("update-42"),
			new TransactionConcurrencyFailure(new Error("race")),
			409,
		],
		[
			"post lifecycle",
			"postTransaction",
			"POST",
			postPath,
			undefined,
			key("post-42"),
			new TransactionLifecycleConflict("voided", "posted"),
			409,
		],
		[
			"void repository",
			"voidTransaction",
			"DELETE",
			itemPath,
			undefined,
			key("void-42"),
			new TransactionRepositoryUnavailable(new Error("offline")),
			503,
		],
		[
			"decoding",
			"getTransaction",
			"GET",
			itemPath,
			undefined,
			{},
			new TransactionPersistenceDecodingFailure(new Error("bad row")),
			500,
		],
	] as const)(
		"maps the %s service failure",
		async (_name, methodName, method, path, body, headers, error, status) => {
			const implementation = service();
			vi.mocked(implementation[methodName]).mockReturnValue(Effect.fail(error) as never);
			const response = await build(implementation)(request(method, path, { body, headers }));

			expect(response.status).toBe(status);
		}
	);

	it("marks a pending Transaction response as retryable after one second", async () => {
		const implementation = service();
		vi
			.mocked(implementation.createTransaction)
			.mockReturnValue(Effect.fail(new IdempotencyPending()));
		const response = await build(implementation)(
			request("POST", collectionPath, { body: createBody, headers: key("create-42") })
		);

		expect(response.status).toBe(409);
		expect(response.headers.get("retry-after")).toBe("1");
		expect(await response.json()).toMatchObject({ type: "CONFLICT", retryable: true });
	});

	it("rejects numeric amounts and ambiguous asset selectors before the service", async () => {
		const implementation = service();
		const handler = build(implementation);
		for (const entry of [
			{ ...createBody.ledgerEntries[0], amount: 500 },
			{ ...createBody.ledgerEntries[0], assetId: "ast_00000000000000000000000001" },
			{ accountId: debitAccountId.toString(), direction: "debit", amount: "500" },
		]) {
			const response = await handler(
				request("POST", collectionPath, {
					headers: key("invalid"),
					body: { ...createBody, ledgerEntries: [entry, createBody.ledgerEntries[1]] },
				})
			);
			expect(response.status).toBe(400);
		}
		expect(implementation.createTransaction).not.toHaveBeenCalled();
	});

	it.each(["01", "-0", "+1", "1.0", "1e3", " 1", "1 ", "", "-9223372036854775809", "0", "-1", 100])(
		"rejects invalid Entry amount %s before the service",
		async amount => {
			const implementation = service();
			const response = await build(implementation)(
				request("POST", collectionPath, {
					headers: key("invalid-amount"),
					body: {
						...createBody,
						ledgerEntries: createBody.ledgerEntries.map(entry => ({ ...entry, amount })),
					},
				})
			);
			expect(response.status).toBe(400);
			expect(implementation.createTransaction).not.toHaveBeenCalled();
		}
	);

	it("serializes exact Entry amounts and effective time through HTTP", async () => {
		const entity = Effect.runSync(
			LedgerTransaction.fromCreateRequest(transactionId, organizationId, ledgerId, {
				...createBody,
				ledgerEntries: createBody.ledgerEntries.map(entry => ({
					...entry,
					amount: "9223372036854775807",
					assetId: "ast_00000000000000000000000001",
					minorUnitExponent: 2,
				})),
			})
		);
		const implementation = service();
		vi.mocked(implementation.getTransaction).mockReturnValue(Effect.succeed(entity));
		const response = await build(implementation)(request("GET", itemPath));
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			effectiveAt: createBody.effectiveAt,
			ledgerEntries: [
				expect.objectContaining({ amount: "9223372036854775807" }),
				expect.objectContaining({ amount: "9223372036854775807" }),
			],
		});
	});

	describe("authentication", () => {
		it("returns 401 Invalid token without a token", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("GET", collectionPath, { anonymous: true })
			);

			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({
				type: "UNAUTHORIZED",
				status: 401,
				detail: "Invalid token",
			});
			expect(implementation.listTransactions).not.toHaveBeenCalled();
		});
	});

	describe("authorization", () => {
		it.each(routes)(
			"returns 403 on %s %s for a token without scope",
			async (method, path, permission, body, headers) => {
				const implementation = service();
				const response = await build(implementation)(
					request(method, path, { token: tokenWith([]), body, headers })
				);

				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({
					type: "FORBIDDEN",
					detail: `One of: ${permission}; permissions is required`,
				});
				for (const method of Object.values(implementation)) expect(method).not.toHaveBeenCalled();
			}
		);
	});

	describe("OpenAPI", () => {
		const spec = OpenApi.fromApi(LedgerApi);
		const operations = (path: string) =>
			spec.paths[path] as unknown as Record<
				string,
				{
					operationId: string;
					responses: object;
					parameters?: Array<{ name: string; in: string; required: boolean }>;
				}
			>;
		const statuses = (path: string, method: string) =>
			Object.keys(operations(path)[method].responses);
		const base = "/api/ledgers/{ledgerId}/transactions";
		const groupOperationIds = new Set([
			"listLedgerTransactions",
			"createLedgerTransaction",
			"getLedgerTransaction",
			"updateLedgerTransaction",
			"voidLedgerTransaction",
			"postLedgerTransaction",
		]);
		const groupOperations = () =>
			Object.values(spec.paths)
				.flatMap(path => Object.values(path ?? {}))
				.filter(operation =>
					groupOperationIds.has(String((operation as { operationId?: unknown }).operationId))
				);

		it("advertises operation-specific failures without 429", () => {
			expect(groupOperations()).toHaveLength(groupOperationIds.size);
			expect(statuses(`${base}/`, "get")).toEqual(expect.arrayContaining(["200", "404"]));
			expect(statuses(`${base}/`, "post")).toEqual(
				expect.arrayContaining(["201", "404", "409", "503"])
			);
			expect(statuses(`${base}/{transactionId}`, "put")).toEqual(
				expect.arrayContaining(["200", "404", "409"])
			);
			expect(statuses(`${base}/{transactionId}`, "delete")).toEqual(
				expect.arrayContaining(["204", "404", "409"])
			);
			expect(statuses(`${base}/{transactionId}/post`, "post")).toEqual(
				expect.arrayContaining(["200", "404", "409"])
			);
			expect(statuses(`${base}/`, "get")).not.toContain("409");
			expect(statuses(`${base}/{transactionId}`, "get")).not.toContain("409");
			expect(JSON.stringify(groupOperations())).not.toContain('"429"');
		});

		it("keeps format date-time on the create request effectiveAt", () => {
			const body = (
				operations(`${base}/`).post as unknown as {
					requestBody: { content: Record<string, { schema: unknown }> };
				}
			).requestBody.content["application/json"].schema;
			expect(JSON.stringify(body)).toContain('"format":"date-time"');
		});

		it("names the operations and requires the idempotency key where it applies", () => {
			expect(operations(`${base}/`).post.operationId).toBe("createLedgerTransaction");
			expect(operations(`${base}/{transactionId}`).delete.operationId).toBe("voidLedgerTransaction");
			expect(operations(`${base}/{transactionId}/post`).post.operationId).toBe(
				"postLedgerTransaction"
			);
			const idempotency = (path: string, method: string) =>
				operations(path)[method].parameters?.find(entry => entry.name === "idempotency-key");
			expect(idempotency(`${base}/`, "post")).toMatchObject({ in: "header", required: true });
			expect(idempotency(`${base}/{transactionId}`, "put")).toMatchObject({ required: true });
			expect(idempotency(`${base}/{transactionId}/post`, "post")).toMatchObject({
				required: true,
			});
			expect(idempotency(`${base}/{transactionId}`, "delete")).toMatchObject({ required: true });
			expect(idempotency(`${base}/`, "get")).toBeUndefined();
		});

		it("documents the list offset and limit as optional", () => {
			const list = operations(`${base}/`).get;
			expect(list.operationId).toBe("listLedgerTransactions");
			for (const name of ["offset", "limit"]) {
				expect(list.parameters?.find(entry => entry.name === name)).toMatchObject({
					in: "query",
					required: false,
				});
			}
		});
	});
});
