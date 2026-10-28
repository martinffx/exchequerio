import { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerApi } from "@/api";
import { signJWT } from "@/auth";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { makeTestWebHandler } from "@/server";
import type { LedgerAccountID, LedgerAccountSettlementID, LedgerID, OrgID } from "@/lib/ids";
import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import type { LedgerAccountSettlementService } from "./LedgerAccountSettlementService";

const orgId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const settlementId = new TypeID("las") as LedgerAccountSettlementID;
const settledAccountId = new TypeID("lat") as LedgerAccountID;
const contraAccountId = new TypeID("lat") as LedgerAccountID;
const date = DateTime.fromISO("2026-09-06T12:00:00Z");
const settlement = new LedgerAccountSettlementEntity({
	id: settlementId,
	organizationId: orgId,
	ledgerId,
	settledAccountId,
	contraAccountId,
	assetId: "ast_00000000000000000000000001",
	assetCode: "USD",
	minorUnitExponent: 2,
	status: "drafting",
	allowEitherDirection: false,
	created: date,
	updated: date,
});
const base = `/api/ledgers/${ledgerId.toString()}/settlements`;
const resource = `${base}/${settlementId.toString()}`;
const payload = {
	settledAccountId: settledAccountId.toString(),
	contraAccountId: contraAccountId.toString(),
	status: "drafting",
};

const service = (): LedgerAccountSettlementService =>
	vi.mocked<LedgerAccountSettlementService>({
		listLedgerAccountSettlements: vi.fn(() => Effect.succeed([settlement])),
		getLedgerAccountSettlement: vi.fn(() => Effect.succeed(settlement)),
		createLedgerAccountSettlement: vi.fn(() => Effect.succeed(settlement)),
		patchLedgerAccountSettlement: vi.fn(() => Effect.succeed(settlement)),
		addLedgerAccountSettlementEntries: vi.fn(() => Effect.void),
		removeLedgerAccountSettlementEntries: vi.fn(() => Effect.void),
		listLedgerAccountSettlementEntries: vi.fn(() => Effect.succeed([])),
	} as unknown as LedgerAccountSettlementService);

const disposers: Array<() => Promise<void>> = [];
const build = (implementation: LedgerAccountSettlementService) => {
	const { handler, dispose } = makeTestWebHandler({ settlement: implementation });
	disposers.push(dispose);
	return handler;
};
afterEach(async () => {
	for (const dispose of disposers.splice(0)) await dispose();
});

const tokenWith = (scope: Parameters<typeof signJWT>[0]["scope"]) =>
	signJWT({ sub: orgId.toString(), scope });
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
	const token = options.anonymous === true ? undefined : (options.token ?? tokenWith(["org_admin"]));
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
const key = (value = crypto.randomUUID()) => ({ "idempotency-key": value });
const entryId = () => new TypeID("lte").toString();

const routes: Array<[string, string, string, unknown]> = [
	["GET", base, "ledger:account:settlement:read", undefined],
	["GET", resource, "ledger:account:settlement:read", undefined],
	["POST", base, "ledger:account:settlement:write", payload],
	["PATCH", resource, "ledger:account:settlement:write", { description: "x" }],
	["PATCH", `${resource}/entries`, "ledger:account:settlement:write", { entries: [entryId()] }],
	["DELETE", `${resource}/entries`, "ledger:account:settlement:write", { entries: [entryId()] }],
	["GET", `${resource}/entries`, "ledger:account:settlement:read", undefined],
];

describe("Settlement routes", () => {
	it("creates a draft and returns its Location", async () => {
		const implementation = service();
		const headers = key();
		const response = await build(implementation)(request("POST", base, { body: payload, headers }));
		expect(response.status).toBe(201);
		expect(response.headers.get("location")).toBe(resource);
		const json = (await response.json()) as Record<string, unknown>;
		expect(json).toMatchObject({ id: settlementId.toString(), ledgerId: ledgerId.toString() });
		expect(json.transactionId).toBeNull();
		expect(json.amount).toBeNull();
		expect(json.settlementEntryDirection).toBeNull();
		expect(json.effectiveAtUpperBound).toBeNull();
		expect(json).not.toHaveProperty("description");
		expect(implementation.createLedgerAccountSettlement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			headers["idempotency-key"],
			expect.objectContaining(payload)
		);
	});

	it("builds Location from the raw ledgerId path parameter", async () => {
		const response = await build(service())(
			request("POST", `/api/ledgers/${ledgerId.toString()}/settlements/`, {
				body: payload,
				headers: key(),
			})
		);
		expect(response.status).toBe(201);
		expect(response.headers.get("location")).toBe(resource);
	});

	it("applies create defaults", async () => {
		const implementation = service();
		const headers = key();
		const response = await build(implementation)(
			request("POST", base, {
				headers,
				body: {
					settledAccountId: payload.settledAccountId,
					contraAccountId: payload.contraAccountId,
				},
			})
		);
		expect(response.status).toBe(201);
		expect(implementation.createLedgerAccountSettlement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			headers["idempotency-key"],
			expect.objectContaining({ status: "pending", allowEitherDirection: false })
		);
	});

	it("scopes listing and forwards pagination", async () => {
		const implementation = service();
		const response = await build(implementation)(request("GET", `${base}?offset=10&limit=5`));
		expect(response.status).toBe(200);
		expect(implementation.listLedgerAccountSettlements).toHaveBeenCalledWith(orgId, ledgerId, 10, 5);
	});

	it("scopes individual lookup to the path Ledger", async () => {
		const other = new TypeID("lgr") as LedgerID;
		const implementation = service();
		vi
			.mocked(implementation.getLedgerAccountSettlement)
			.mockReturnValue(Effect.fail(new NotFoundError("Settlement not found")));
		const response = await build(implementation)(
			request("GET", `/api/ledgers/${other.toString()}/settlements/${settlementId.toString()}`)
		);
		expect(response.status).toBe(404);
		expect(implementation.getLedgerAccountSettlement).toHaveBeenCalledWith(
			orgId,
			other,
			settlementId
		);
	});

	it("patches metadata and status with the full scope", async () => {
		const implementation = service();
		const headers = key();
		const patch = { status: "pending", metadata: { batch: "daily" } };
		const response = await build(implementation)(
			request("PATCH", resource, {
				token: tokenWith(["org_user"]),
				headers,
				body: patch,
			})
		);
		expect(response.status).toBe(200);
		expect(implementation.patchLedgerAccountSettlement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			settlementId,
			headers["idempotency-key"],
			patch
		);
	});

	it("requires delete permission in addition to write for voiding", async () => {
		const implementation = service();
		const handler = build(implementation);
		const denied = await handler(
			request("PATCH", resource, {
				token: tokenWith(["org_user"]),
				headers: key(),
				body: { status: "voided" },
			})
		);
		expect(denied.status).toBe(403);
		const problem = (await denied.json()) as { type: string; detail: string };
		expect(problem.type).toBe("FORBIDDEN");
		expect(problem.detail).toBe("One of: ledger:account:settlement:delete; permissions is required");
		expect(implementation.patchLedgerAccountSettlement).not.toHaveBeenCalled();
		const allowed = await handler(
			request("PATCH", resource, { headers: key(), body: { status: "voided" } })
		);
		expect(allowed.status).toBe(200);
	});

	it.each(["PATCH", "DELETE"] as const)(
		"%s membership returns 204 and forwards scope",
		async method => {
			const implementation = service();
			const headers = key();
			const entries = [entryId()];
			const response = await build(implementation)(
				request(method, `${resource}/entries`, { headers, body: { entries } })
			);
			expect(response.status).toBe(204);
			expect(await response.text()).toBe("");
			expect(
				method === "PATCH"
					? implementation.addLedgerAccountSettlementEntries
					: implementation.removeLedgerAccountSettlementEntries
			).toHaveBeenCalledWith(orgId, ledgerId, settlementId, headers["idempotency-key"], entries);
		}
	);

	it("lists sources with default pagination and read permission", async () => {
		const implementation = service();
		const response = await build(implementation)(
			request("GET", `${resource}/entries`, { token: tokenWith(["org_readonly"]) })
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([]);
		expect(implementation.listLedgerAccountSettlementEntries).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			settlementId,
			0,
			20
		);
	});

	it.each(["offset=-1", "offset=10001", "limit=0", "limit=101", "offset=1.5"])(
		"rejects invalid pagination %s",
		async query => {
			const implementation = service();
			const handler = build(implementation);
			for (const url of [base, `${resource}/entries`]) {
				const response = await handler(request("GET", `${url}?${query}`));
				expect(response.status).toBe(400);
				expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
			}
			expect(implementation.listLedgerAccountSettlements).not.toHaveBeenCalled();
			expect(implementation.listLedgerAccountSettlementEntries).not.toHaveBeenCalled();
		}
	);

	it.each(
		[
			[],
			["invalid"],
			Array.from({ length: 501 }, () => entryId()),
			(() => {
				const id = entryId();
				return [id, id];
			})(),
		].map(entries => ({ entries }))
	)("rejects invalid membership input %#", async ({ entries }) => {
		const implementation = service();
		const handler = build(implementation);
		for (const method of ["PATCH", "DELETE"]) {
			const response = await handler(
				request(method, `${resource}/entries`, { headers: key(), body: { entries } })
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "BAD_REQUEST" });
		}
		expect(implementation.addLedgerAccountSettlementEntries).not.toHaveBeenCalled();
		expect(implementation.removeLedgerAccountSettlementEntries).not.toHaveBeenCalled();
	});

	it("accepts 500 distinct entries", async () => {
		const implementation = service();
		const response = await build(implementation)(
			request("PATCH", `${resource}/entries`, {
				headers: key(),
				body: { entries: Array.from({ length: 500 }, () => entryId()) },
			})
		);
		expect(response.status).toBe(204);
	});

	it.each(["drafting", "processing", "invalid"])("rejects client patch status %s", async status => {
		const implementation = service();
		const response = await build(implementation)(
			request("PATCH", resource, { headers: key(), body: { status } })
		);
		expect(response.status).toBe(400);
		expect(implementation.patchLedgerAccountSettlement).not.toHaveBeenCalled();
	});

	it.each(["2026-09-06 12:00:00Z", "2026-12-31T23:59:60Z", "2026-02-30T12:00:00Z", "nope"])(
		"rejects effectiveAtUpperBound %s",
		async effectiveAtUpperBound => {
			const implementation = service();
			const response = await build(implementation)(
				request("POST", base, {
					headers: key(),
					body: { ...payload, status: "pending", effectiveAtUpperBound },
				})
			);
			expect(response.status).toBe(400);
			expect(implementation.createLedgerAccountSettlement).not.toHaveBeenCalled();
		}
	);

	it("accepts an RFC 3339 effectiveAtUpperBound and strips unknown body fields", async () => {
		const implementation = service();
		const response = await build(implementation)(
			request("POST", base, {
				headers: key(),
				body: {
					...payload,
					status: "pending",
					effectiveAtUpperBound: "2026-09-06T12:00:00+02:00",
					unknown: "dropped",
				},
			})
		);
		expect(response.status).toBe(201);
		const [, , , body] = vi.mocked(implementation.createLedgerAccountSettlement).mock.calls[0];
		expect(body).not.toHaveProperty("unknown");
		expect(body.effectiveAtUpperBound).toBe("2026-09-06T12:00:00+02:00");
	});

	it("requires a client key on mutations", async () => {
		const implementation = service();
		const response = await build(implementation)(request("POST", base, { body: payload }));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST" });
		expect(implementation.createLedgerAccountSettlement).not.toHaveBeenCalled();
	});

	it("rejects readonly writes", async () => {
		const implementation = service();
		const response = await build(implementation)(
			request("POST", base, {
				token: tokenWith(["org_readonly"]),
				headers: key(),
				body: payload,
			})
		);
		expect(response.status).toBe(403);
		expect(implementation.createLedgerAccountSettlement).not.toHaveBeenCalled();
	});

	it("requires authentication", async () => {
		const implementation = service();
		const response = await build(implementation)(request("GET", base, { anonymous: true }));
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ type: "UNAUTHORIZED", detail: "Invalid token" });
		expect(implementation.listLedgerAccountSettlements).not.toHaveBeenCalled();
	});

	it.each(["PUT", "DELETE"] as const)("removes resource %s", async method => {
		const response = await build(service())(
			request(method, resource, { headers: key(), body: payload })
		);
		expect(response.status).toBe(404);
	});

	it("removes status POST", async () => {
		const response = await build(service())(
			request("POST", `${resource}/pending`, { headers: key() })
		);
		expect(response.status).toBe(404);
	});

	it("translates a service conflict", async () => {
		const implementation = service();
		vi
			.mocked(implementation.patchLedgerAccountSettlement)
			.mockReturnValue(Effect.fail(new ConflictError("Cannot change a posted Settlement")));
		const response = await build(implementation)(
			request("PATCH", resource, { headers: key(), body: { status: "voided" } })
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			type: "CONFLICT",
			detail: "Cannot change a posted Settlement",
		});
	});

	describe("authorization", () => {
		it.each(routes)(
			"returns 403 on %s %s for a token without scope",
			async (method, path, permission, body) => {
				const implementation = service();
				const response = await build(implementation)(
					request(method, path, { token: tokenWith([]), body, headers: key() })
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
		type Operation = {
			operationId: string;
			responses: object;
			parameters?: Array<{ name: string; in: string; required: boolean }>;
		};
		const operations = (path: string) => spec.paths[path] as unknown as Record<string, Operation>;
		const statuses = (path: string, method: string) =>
			Object.keys(operations(path)[method].responses);
		const collection = "/api/ledgers/{ledgerId}/settlements/";
		const item = "/api/ledgers/{ledgerId}/settlements/{settlementId}";
		const entries = `${item}/entries`;
		const groupOperationIds = [
			"listLedgerAccountSettlements",
			"getLedgerAccountSettlement",
			"createLedgerAccountSettlement",
			"patchLedgerAccountSettlement",
			"addLedgerAccountSettlementEntries",
			"removeLedgerAccountSettlementEntries",
			"listLedgerAccountSettlementEntries",
		];
		const groupOperations = () =>
			Object.values(spec.paths)
				.flatMap(path => Object.values(path ?? {}) as Operation[])
				.filter(operation => groupOperationIds.includes(operation.operationId));

		it("declares 429 on every Settlement operation", () => {
			const found = groupOperations();
			expect(found.map(operation => operation.operationId).sort()).toEqual(
				[...groupOperationIds].sort()
			);
			for (const operation of found) expect(Object.keys(operation.responses)).toContain("429");
		});

		it("advertises operation-specific failures", () => {
			expect(statuses(collection, "get")).toEqual(
				expect.arrayContaining(["200", "400", "401", "403"])
			);
			expect(statuses(collection, "get")).not.toContain("404");
			expect(statuses(collection, "get")).not.toContain("409");
			expect(statuses(item, "get")).toEqual(expect.arrayContaining(["200", "404"]));
			expect(statuses(item, "get")).not.toContain("409");
			// The service fails with 404 when the settled Account is missing, so create declares it.
			expect(statuses(collection, "post")).toEqual(expect.arrayContaining(["201", "409", "404"]));
			expect(statuses(item, "patch")).toEqual(expect.arrayContaining(["200", "404", "409"]));
			expect(statuses(entries, "patch")).toEqual(expect.arrayContaining(["204", "404", "409"]));
			expect(statuses(entries, "delete")).toEqual(expect.arrayContaining(["204", "404", "409"]));
			expect(statuses(entries, "get")).toEqual(expect.arrayContaining(["200", "404"]));
			expect(statuses(entries, "get")).not.toContain("409");
		});

		it("names operations and requires the idempotency key on writes only", () => {
			const idempotency = (path: string, method: string) =>
				operations(path)[method].parameters?.find(entry => entry.name === "idempotency-key");
			for (const [path, method] of [
				[collection, "post"],
				[item, "patch"],
				[entries, "patch"],
				[entries, "delete"],
			] as const)
				expect(idempotency(path, method)).toMatchObject({ in: "header", required: true });
			expect(idempotency(collection, "get")).toBeUndefined();
			expect(idempotency(entries, "get")).toBeUndefined();
		});

		it("documents the list offset and limit as optional", () => {
			for (const [path] of [[collection], [entries]])
				for (const name of ["offset", "limit"])
					expect(operations(path).get.parameters?.find(entry => entry.name === name)).toMatchObject({
						in: "query",
						required: false,
					});
		});

		it("keeps format date-time on the create request effectiveAtUpperBound", () => {
			const body = (
				operations(collection).post as unknown as {
					requestBody: { content: Record<string, { schema: unknown }> };
				}
			).requestBody.content["application/json"].schema;
			const request = spec.components.schemas.LedgerAccountSettlementRequest as unknown as {
				properties: Record<string, { format?: string }>;
			};
			expect(request.properties.effectiveAtUpperBound.format).toBe("date-time");
			expect(JSON.stringify(body)).toContain("LedgerAccountSettlementRequest");
		});

		it("locks the Settlement body schemas", () => {
			const { schemas } = spec.components;
			expect({
				LedgerAccountSettlementRequest: schemas.LedgerAccountSettlementRequest,
				LedgerAccountSettlementResponse: schemas.LedgerAccountSettlementResponse,
				LedgerAccountSettlementResponse_1: schemas.LedgerAccountSettlementResponse_1,
			}).toMatchSnapshot();
		});

		it("documents the create defaults as optional properties", () => {
			const request = spec.components.schemas.LedgerAccountSettlementRequest as unknown as {
				properties: Record<string, { default?: unknown }>;
				required: string[];
			};
			expect(request.properties.status.default).toBe("pending");
			expect(request.properties.allowEitherDirection.default).toBe(false);
			expect(request.required).toEqual(["settledAccountId", "contraAccountId"]);
		});
	});
});
