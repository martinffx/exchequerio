import { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { LedgerApi } from "@/api";
import { makeRequest, tokenFor, useTestWebHandlers } from "@/lib/testing";
import { ServiceUnavailableError } from "@/lib/errors";
import type { LedgerID, OrgID } from "@/lib/ids";
import { Ledger } from "./Ledger";
import { LedgerHasDependents, LedgerNotFound } from "./LedgerErrors";
import type { LedgerService } from "./LedgerService";

const organizationId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const ledger = new Ledger({
	id: ledgerId,
	organizationId,
	name: "Operating Ledger",
	description: "Primary book",
	metadata: { externalId: "book-42" },
	created: DateTime.fromISO("2026-08-09T10:00:00.000Z", { zone: "utc" }),
	updated: DateTime.fromISO("2026-08-09T10:00:00.000Z", { zone: "utc" }),
});

const service = (): LedgerService =>
	vi.mocked<LedgerService>({
		listLedgers: vi.fn(() => Effect.succeed([ledger])),
		getLedger: vi.fn(() => Effect.succeed(ledger)),
		createLedger: vi.fn(() => Effect.succeed(ledger)),
		updateLedger: vi.fn(() => Effect.succeed(ledger)),
		deleteLedger: vi.fn(() => Effect.void),
	} as unknown as LedgerService);

const buildHandler = useTestWebHandlers();

const build = (implementation: LedgerService) => {
	return buildHandler({ ledger: implementation });
};

const tokenWith = tokenFor(organizationId);
const allPermissions = () => tokenWith(["super_admin"]);
const request = makeRequest(allPermissions);

const ledgerPath = `/api/ledgers/${ledgerId.toString()}`;
const routes: Array<[string, string, string, unknown]> = [
	["GET", "/api/ledgers", "ledger:read", undefined],
	["GET", ledgerPath, "ledger:read", undefined],
	["POST", "/api/ledgers", "ledger:write", { name: "Operating Ledger" }],
	["PUT", ledgerPath, "ledger:write", { name: "Replaced" }],
	["DELETE", ledgerPath, "ledger:delete", undefined],
];

describe("LedgerRoutes", () => {
	it("forwards list pagination defaults and the authenticated Organization", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(request("GET", "/api/ledgers"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([
			{
				id: ledgerId.toString(),
				name: "Operating Ledger",
				description: "Primary book",
				metadata: { externalId: "book-42" },
				created: "2026-08-09T10:00:00.000Z",
				updated: "2026-08-09T10:00:00.000Z",
			},
		]);
		expect(implementation.listLedgers).toHaveBeenCalledWith(organizationId, {
			offset: 0,
			limit: 20,
		});
	});

	it("forwards explicit list pagination", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(request("GET", "/api/ledgers?offset=10000&limit=100"));

		expect(response.status).toBe(200);
		expect(implementation.listLedgers).toHaveBeenCalledWith(organizationId, {
			offset: 10_000,
			limit: 100,
		});
	});

	it.each(["offset=-1", "offset=10001", "limit=0", "limit=101", "offset=1.5"])(
		"rejects invalid pagination: %s",
		async query => {
			const implementation = service();
			const handler = build(implementation);

			const response = await handler(request("GET", `/api/ledgers?${query}`));

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
			expect(implementation.listLedgers).not.toHaveBeenCalled();
		}
	);

	it("passes the tenant and canonical Ledger ID to get", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(request("GET", ledgerPath));

		expect(response.status).toBe(200);
		expect(implementation.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
	});

	it.each(["not-a-ledger", ledgerId.toString().toUpperCase()])(
		"rejects malformed or noncanonical Ledger ID %s",
		async invalidId => {
			const implementation = service();
			const handler = build(implementation);

			const response = await handler(request("GET", `/api/ledgers/${invalidId}`));

			expect(response.status).toBe(400);
			expect(implementation.getLedger).not.toHaveBeenCalled();
		}
	);

	it("strips undeclared create fields and returns 201 with Location", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(
			request("POST", "/api/ledgers", {
				body: {
					name: "Operating Ledger",
					description: "Primary book",
					metadata: { externalId: "book-42" },
					currency: "EUR",
					currencyExponent: 2,
					ignored: true,
				},
			})
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("location")).toBe(`/api/ledgers/${ledgerId.toString()}`);
		expect(await response.json()).not.toHaveProperty("currency");
		expect(implementation.createLedger).toHaveBeenCalledWith(organizationId, {
			name: "Operating Ledger",
			description: "Primary book",
			metadata: { externalId: "book-42" },
		});
	});

	it("strips undeclared update fields and forwards replacement input", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(
			request("PUT", ledgerPath, { body: { name: "Replaced", currency: "EUR", ignored: true } })
		);

		expect(response.status).toBe(200);
		expect(implementation.updateLedger).toHaveBeenCalledWith(organizationId, ledgerId, {
			name: "Replaced",
		});
	});

	it.each([
		["POST", "/api/ledgers", {}],
		["PUT", ledgerPath, { name: "Valid", metadata: "invalid" }],
		["POST", "/api/ledgers", { name: 123 }],
	] as const)("rejects malformed declared fields for %s %s", async (method, url, body) => {
		const handler = build(service());

		const response = await handler(request(method, url, { body }));

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
	});

	it("deletes with an empty 204 and forwards tenant scope", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(request("DELETE", ledgerPath));

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
		expect(implementation.deleteLedger).toHaveBeenCalledWith(organizationId, ledgerId);
	});

	it("maps typed not-found and dependency failures", async () => {
		const implementation = service();
		vi.mocked(implementation.getLedger).mockReturnValue(Effect.fail(new LedgerNotFound()));
		vi.mocked(implementation.deleteLedger).mockReturnValue(Effect.fail(new LedgerHasDependents()));
		const handler = build(implementation);

		const notFound = await handler(request("GET", ledgerPath));
		const conflict = await handler(request("DELETE", ledgerPath));

		expect(notFound.status).toBe(404);
		expect(await notFound.json()).toMatchObject({ type: "NOT_FOUND" });
		expect(conflict.status).toBe(409);
	});

	it("returns non-retryable 503 for create-time unavailability", async () => {
		const implementation = service();
		vi
			.mocked(implementation.createLedger)
			.mockReturnValue(
				Effect.fail(new ServiceUnavailableError("Ledger repository unavailable", { retryable: false }))
			);
		const handler = build(implementation);

		const response = await handler(
			request("POST", "/api/ledgers", { body: { name: "Operating Ledger" } })
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ type: "SERVICE_UNAVAILABLE", retryable: false });
	});

	describe("authentication", () => {
		it("returns 401 Invalid token without a token", async () => {
			const implementation = service();
			const handler = build(implementation);

			const response = await handler(request("GET", "/api/ledgers", { anonymous: true }));

			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({
				type: "UNAUTHORIZED",
				status: 401,
				detail: "Invalid token",
			});
			expect(implementation.listLedgers).not.toHaveBeenCalled();
		});
	});

	describe("authorization", () => {
		it.each(routes)(
			"returns 403 on %s %s for a token without scope",
			async (method, path, permission, body) => {
				const implementation = service();
				const handler = build(implementation);

				const response = await handler(request(method, path, { token: tokenWith([]), body }));

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
		const groupOperations = (...ids: string[]) =>
			Object.values(spec.paths)
				.flatMap(path => Object.values(path ?? {}))
				.filter(operation =>
					ids.includes(String((operation as { operationId?: unknown }).operationId))
				);

		it("advertises only operation-specific failures", () => {
			const statuses = (path: string, method: "get" | "post" | "put" | "delete") =>
				Object.keys(
					(spec.paths[path] as unknown as Record<string, { responses: object }>)[method].responses
				);

			expect(Object.keys(spec.paths)).toContain("/api/ledgers/");
			expect(statuses("/api/ledgers/", "post")).toEqual(expect.arrayContaining(["201", "404"]));
			expect(statuses("/api/ledgers/", "post")).not.toContain("409");
			expect(statuses("/api/ledgers/{ledgerId}", "delete")).toContain("409");
			expect(statuses("/api/ledgers/{ledgerId}", "put")).not.toContain("409");
			const own = groupOperations(
				"listLedgers",
				"getLedger",
				"createLedger",
				"updateLedger",
				"deleteLedger"
			);
			expect(own).toHaveLength(5);
			expect(JSON.stringify(own)).not.toContain('"429"');
		});

		it("documents the list offset and limit as optional", () => {
			const list = (spec.paths["/api/ledgers/"] as unknown as Record<string, unknown>).get as {
				operationId: string;
				parameters: Array<{ name: string; in: string; required: boolean }>;
			};
			expect(list.operationId).toBe("listLedgers");
			expect(list.parameters.find(entry => entry.name === "offset")).toMatchObject({
				in: "query",
				required: false,
			});
			expect(list.parameters.find(entry => entry.name === "limit")).toMatchObject({
				in: "query",
				required: false,
			});
		});
	});
});
