import { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";

import { LedgerApi } from "@/api";
import { makeRequest, tokenFor, useTestWebHandlers } from "@/lib/testing";
import { InternalServerError } from "@/lib/errors";
import type { LedgerAccountBalanceMonitorID, LedgerAccountID, OrgID } from "@/lib/ids";

import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import type { LedgerAccountBalanceMonitorResponse } from "./LedgerAccountBalanceMonitorSchema";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { LedgerAccountBalanceMonitorNotFound } from "./LedgerAccountBalanceMonitorErrors";
import type { LedgerAccountBalanceMonitorRequest } from "./LedgerAccountBalanceMonitorSchema";
import type { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";

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
		conditions: [{ balanceType: "posted", operator: "<", value: "100" }],
	},
	webhook: {
		url: "https://example.com/hook",
		signingSecret: "whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
	},
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

const buildHandler = useTestWebHandlers();
const build = (implementation: ReturnType<typeof service>) => {
	// The complete public double omits only the class's private repository field.
	return buildHandler({
		balanceMonitor: implementation as unknown as LedgerAccountBalanceMonitorService,
	});
};
const tokenWith = tokenFor(organizationId);
const buildRequest = makeRequest(() => tokenWith(["org_admin"]));

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
		const handler = build(implementation);
		const [get, list] = await Promise.all([
			handler(buildRequest("GET", itemUrl)),
			handler(buildRequest("GET", collectionUrl)),
		]);

		expect(get.status).toBe(200);
		expect(list.status).toBe(200);
		for (const body of [
			(await get.json()) as LedgerAccountBalanceMonitorResponse,
			((await list.json()) as LedgerAccountBalanceMonitorResponse[])[0],
		]) {
			expect(body.id).toBe(monitorId.toString());
			if (expected === undefined) expect(body).not.toHaveProperty("metadata");
			else expect(body.metadata).toEqual(expected);
		}
	});

	it("forwards authenticated scope on GET and redacts credentials", async () => {
		const implementation = service();
		const response = await build(implementation)(buildRequest("GET", itemUrl));
		expect(response.status).toBe(200);
		expect(implementation.getLedgerAccountBalanceMonitor).toHaveBeenCalledWith(
			scope,
			monitorId.toString()
		);
		const text = await response.text();
		expect(JSON.parse(text)).toMatchObject({
			alertCondition: request.alertCondition,
			webhook: { url: request.webhook.url },
			lockVersion: 1,
		});
		expect(text).not.toContain("secret");
		expect(JSON.parse(text)).not.toHaveProperty("balances");
	});

	it("requires a token on creation and permits omission on update", async () => {
		const implementation = service();
		const handler = build(implementation);
		const payload = { ...request, webhook: { url: request.webhook.url } };
		const created = await handler(buildRequest("POST", collectionUrl, { body: payload }));
		expect(created.status).toBe(400);
		expect(await created.json()).toMatchObject({ type: "BAD_REQUEST" });
		const updated = await handler(buildRequest("PUT", itemUrl, { body: payload }));
		expect(updated.status).toBe(200);
	});

	it.each([
		{ mode: "all", conditions: [] },
		{ mode: "all", conditions: [{ balanceType: "posted", operator: "<", value: 0.5 }] },
		{
			mode: "all",
			conditions: [{ balanceType: "posted", operator: "<", value: Number.MAX_SAFE_INTEGER + 1 }],
		},
		{ mode: "all", conditions: [{ balanceType: "missing", operator: "<", value: "1" }] },
		{ mode: "nested", conditions: [{ balanceType: "posted", operator: "<", value: "1" }] },
	])("rejects invalid conditions %#", async alertCondition => {
		const implementation = service();
		const handler = build(implementation);
		for (const [method, path] of [
			["POST", collectionUrl],
			["PUT", itemUrl],
		] as const) {
			const response = await handler(
				buildRequest(method, path, {
					body: { ...request, alertCondition },
				})
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "BAD_REQUEST" });
		}
		expect(implementation.createLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
		expect(implementation.updateLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
	});

	it("rejects a numeric threshold without coercing it", async () => {
		const implementation = service();
		const response = await build(implementation)(
			buildRequest("POST", collectionUrl, {
				body: {
					...request,
					alertCondition: {
						mode: "all",
						conditions: [{ balanceType: "posted", operator: "<", value: 100 }],
					},
				},
			})
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
		expect(implementation.createLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
	});

	it.each(["007", "1".repeat(21)])("rejects the non-canonical threshold %s", async value => {
		const implementation = service();
		const response = await build(implementation)(
			buildRequest("POST", collectionUrl, {
				body: {
					...request,
					alertCondition: {
						mode: "all",
						conditions: [{ balanceType: "posted", operator: "<", value }],
					},
				},
			})
		);
		expect(response.status).toBe(400);
		expect(implementation.createLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
	});

	it("accepts a negative canonical threshold", async () => {
		const implementation = service();
		const response = await build(implementation)(
			buildRequest("POST", collectionUrl, {
				body: {
					...request,
					alertCondition: {
						mode: "all",
						conditions: [{ balanceType: "posted", operator: "<", value: "-12" }],
					},
				},
			})
		);
		expect(response.status).toBe(200);
		expect(implementation.createLedgerAccountBalanceMonitor).toHaveBeenCalledTimes(1);
	});

	it.each([
		["a non-URI callback", { ...request.webhook, url: "not a uri" }],
		["a malformed signing secret", { ...request.webhook, signingSecret: "whsec_short" }],
	])("rejects %s", async (_name, webhook) => {
		const implementation = service();
		const response = await build(implementation)(
			buildRequest("POST", collectionUrl, {
				body: { ...request, webhook },
			})
		);
		expect(response.status).toBe(400);
		expect(implementation.createLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
	});

	// Expectations were checked against the former validator: Ajv with ajv-formats 3.0.1 in "full" mode.
	const rejectedUris = [
		"https:",
		"https://example.com/<x>",
		"https://example.com/%zz",
		"https://example.com/a{b}",
		"https://example.com/a|b",
		"https://example.com/a\\b",
		"https://example.com/a^b",
		"https://example.com/a`b",
		'https://example.com/a"b',
		"https://example.com/é",
		"http://[::1/x",
		"not a uri",
		"example.com",
		"https://exa mple.com",
		"https://user:pa ss@example.com",
	];
	const acceptedUris = [
		"mailto:ops@example.com",
		"urn:example:x",
		"javascript:alert(1)",
		"https://example.com:abc/",
		"https://ex_ample.com",
		"https://example.com/a/b?q=1#f",
	];

	it.each(rejectedUris.flatMap(url => [["POST", url] as const, ["PUT", url] as const]))(
		"rejects the %s callback URL %s as legacy Ajv did",
		async (method, url) => {
			const implementation = service();
			const response = await build(implementation)(
				buildRequest(method, method === "POST" ? collectionUrl : itemUrl, {
					body: { ...request, webhook: { ...request.webhook, url } },
				})
			);
			expect(response.status).toBe(400);
			expect(implementation.createLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
			expect(implementation.updateLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
		}
	);

	it.each(acceptedUris.flatMap(url => [["POST", url] as const, ["PUT", url] as const]))(
		"accepts the %s callback URL %s as legacy Ajv did",
		async (method, url) => {
			const implementation = service();
			const response = await build(implementation)(
				buildRequest(method, method === "POST" ? collectionUrl : itemUrl, {
					body: { ...request, webhook: { ...request.webhook, url } },
				})
			);
			expect(response.status).toBe(200);
			const called =
				method === "POST"
					? implementation.createLedgerAccountBalanceMonitor
					: implementation.updateLedgerAccountBalanceMonitor;
			expect(called).toHaveBeenCalledTimes(1);
		}
	);

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
		const metadata = { team: "treasury", purpose: "low balance" };
		const response = await build(implementation)(
			buildRequest("POST", collectionUrl, {
				body: { ...request, metadata },
			})
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ metadata });
		expect(implementation.createLedgerAccountBalanceMonitor).toHaveBeenCalledWith(scope, {
			...request,
			metadata,
		});
	});

	it.each([
		["a token that is not valid", { token: "invalid-token" }],
		["no token", { anonymous: true }],
	])("returns 401 for %s", async (_name, options) => {
		const implementation = service();
		const response = await build(implementation)(buildRequest("GET", collectionUrl, options));
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ type: "UNAUTHORIZED" });
		expect(implementation.listLedgerAccountBalanceMonitors).not.toHaveBeenCalled();
	});

	it("rejects readonly writes", async () => {
		const implementation = service();
		const response = await build(implementation)(
			buildRequest("POST", collectionUrl, {
				token: tokenWith(["org_readonly"]),
				body: request,
			})
		);
		expect(response.status).toBe(403);
		expect(implementation.createLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
	});

	it("lists through the Effect service with the existing defaults and response", async () => {
		const implementation = service();
		const response = await build(implementation)(buildRequest("GET", collectionUrl));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchSnapshot();
		expect(implementation.listLedgerAccountBalanceMonitors).toHaveBeenCalledWith(scope, 0, 20);
	});

	it("forwards explicit list pagination", async () => {
		const implementation = service();
		const response = await build(implementation)(
			buildRequest("GET", `${collectionUrl}?offset=10&limit=5`)
		);

		expect(response.status).toBe(200);
		expect(implementation.listLedgerAccountBalanceMonitors).toHaveBeenCalledWith(scope, 10, 5);
	});

	it("accepts the collection path with a trailing slash", async () => {
		const response = await build(service())(buildRequest("GET", `${collectionUrl}/`));
		expect(response.status).toBe(200);
	});

	it("rejects malformed parent path IDs", async () => {
		const implementation = service();
		const response = await build(implementation)(
			buildRequest(
				"GET",
				`/api/ledgers/not-a-ledger/accounts/not-an-account/balance-monitors/${monitorId.toString()}`
			)
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST" });
		expect(implementation.getLedgerAccountBalanceMonitor).not.toHaveBeenCalled();
	});

	it("creates with the existing 200 response", async () => {
		const implementation = service();
		const response = await build(implementation)(
			buildRequest("POST", collectionUrl, { body: request })
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("location")).toBeNull();
		expect(await response.json()).toMatchSnapshot();
		expect(implementation.createLedgerAccountBalanceMonitor).toHaveBeenCalledWith(scope, request);
	});

	it("updates with the existing response and service inputs", async () => {
		const implementation = service();
		const response = await build(implementation)(buildRequest("PUT", itemUrl, { body: request }));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchSnapshot();
		expect(implementation.updateLedgerAccountBalanceMonitor).toHaveBeenCalledWith(
			scope,
			monitorId.toString(),
			request
		);
	});

	it("deletes with the existing empty 200 response", async () => {
		const implementation = service();
		const response = await build(implementation)(buildRequest("DELETE", itemUrl));

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
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

			const response = await build(implementation)(
				buildRequest(
					operation === "update" ? "PUT" : operation === "delete" ? "DELETE" : "GET",
					itemUrl,
					operation === "update" ? { body: request } : {}
				)
			);

			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({
				type: "NOT_FOUND",
				detail: `Balance monitor not found: ${monitorId.toString()}`,
			});
		}
	);

	it("answers the 404 problem when listing a missing account", async () => {
		const implementation = service();
		vi
			.mocked(implementation.listLedgerAccountBalanceMonitors)
			.mockReturnValue(Effect.fail(new NotFoundError("Account not found")));
		const response = await build(implementation)(buildRequest("GET", collectionUrl));
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({
			type: "NOT_FOUND",
			detail: "Account not found",
		});
	});

	it("maps conflicts on create, update and delete to 409", async () => {
		const implementation = service();
		// The service does not type a conflict failure; the routes still declare 409.
		const failure = Effect.fail(new ConflictError("Monitor changed")) as never;
		vi.mocked(implementation.createLedgerAccountBalanceMonitor).mockReturnValue(failure);
		vi.mocked(implementation.updateLedgerAccountBalanceMonitor).mockReturnValue(failure);
		vi.mocked(implementation.deleteLedgerAccountBalanceMonitor).mockReturnValue(failure);
		const handler = build(implementation);
		for (const [method, path, body] of [
			["POST", collectionUrl, request],
			["PUT", itemUrl, request],
			["DELETE", itemUrl, undefined],
		] as const) {
			const response = await handler(buildRequest(method, path, { body }));
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({ type: "CONFLICT", detail: "Monitor changed" });
		}
	});

	it("preserves pagination validation", async () => {
		const implementation = service();
		const invalid = await build(implementation)(
			buildRequest("GET", `${collectionUrl}?offset=invalid`)
		);
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toMatchObject({ type: "BAD_REQUEST" });
		expect(implementation.listLedgerAccountBalanceMonitors).not.toHaveBeenCalled();
	});

	it("keeps unexpected service failures on the sanitized 500 path", async () => {
		const implementation = service();
		vi
			.mocked(implementation.listLedgerAccountBalanceMonitors)
			.mockReturnValue(Effect.fail(new InternalServerError("Internal Server Error")));

		const response = await build(implementation)(buildRequest("GET", collectionUrl));

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			type: "INTERNAL_SERVER_ERROR",
			detail: "Internal Server Error",
		});
	});

	describe("authorization", () => {
		const routes: Array<[string, string, string, unknown]> = [
			["GET", collectionUrl, "ledger:account:balance_monitor:read", undefined],
			["GET", itemUrl, "ledger:account:balance_monitor:read", undefined],
			["POST", collectionUrl, "ledger:account:balance_monitor:write", request],
			["PUT", itemUrl, "ledger:account:balance_monitor:write", request],
			["DELETE", itemUrl, "ledger:account:balance_monitor:delete", undefined],
		];
		it.each(routes)(
			"returns 403 on %s %s for a token without scope",
			async (method, path, permission, body) => {
				const implementation = service();
				const response = await build(implementation)(
					buildRequest(method, path, {
						token: tokenWith([]),
						body,
					})
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
		type Schema = {
			type?: string;
			format?: string;
			writeOnly?: boolean;
			minItems?: number;
			pattern?: string;
			required?: string[];
			properties?: Record<string, Schema>;
			items?: Schema;
		};
		type Operation = {
			operationId: string;
			tags?: string[];
			responses: Record<string, unknown>;
			requestBody?: { content: Record<string, { schema: Schema }> };
		};
		const spec = OpenApi.fromApi(LedgerApi);
		const collection = "/api/ledgers/{ledgerId}/accounts/{accountId}/balance-monitors/";
		const item = `${collection}{balanceMonitorId}`;
		const groupOperationIds = [
			"listLedgerAccountBalanceMonitors",
			"getLedgerAccountBalanceMonitor",
			"createLedgerAccountBalanceMonitor",
			"updateLedgerAccountBalanceMonitor",
			"deleteLedgerAccountBalanceMonitor",
		];
		const operations = Object.values(spec.paths)
			.flatMap(path => Object.values(path ?? {}) as Operation[])
			.filter(operation => groupOperationIds.includes(operation.operationId));
		const byId = (id: string) => operations.find(operation => operation.operationId === id);
		const statuses = (id: string) => Object.keys(byId(id)?.responses ?? {});

		it("preserves the existing OpenAPI operations and response sets", () => {
			expect({
				collection: spec.paths[collection],
				item: spec.paths[item],
			}).toMatchSnapshot();
			expect(operations.map(operation => operation.operationId).sort()).toEqual(
				[...groupOperationIds].sort()
			);
			expect(Object.keys(spec.paths[collection] ?? {}).sort()).toEqual(["get", "post"]);
			expect(Object.keys(spec.paths[item] ?? {}).sort()).toEqual(["delete", "get", "put"]);
			expect(statuses("listLedgerAccountBalanceMonitors")).toEqual([
				"200",
				"400",
				"401",
				"403",
				"404",
				"429",
				"500",
				"503",
			]);
			expect(statuses("getLedgerAccountBalanceMonitor")).toEqual([
				"200",
				"400",
				"401",
				"403",
				"404",
				"429",
				"500",
				"503",
			]);
			for (const id of [
				"createLedgerAccountBalanceMonitor",
				"updateLedgerAccountBalanceMonitor",
				"deleteLedgerAccountBalanceMonitor",
			])
				expect(statuses(id)).toEqual(["200", "400", "401", "403", "404", "409", "429", "500", "503"]);
			for (const operation of operations)
				expect(operation.tags).toEqual(["Ledger Account Balance Monitors"]);
			expect(byId("deleteLedgerAccountBalanceMonitor")?.responses["200"]).not.toHaveProperty(
				"content"
			);
		});

		it("keeps the request constraints, the uri format and the write-only secret", () => {
			const requestSchema = (id: string) =>
				byId(id)?.requestBody?.content["application/json"]?.schema as Schema;
			const create = requestSchema("createLedgerAccountBalanceMonitor");
			const update = requestSchema("updateLedgerAccountBalanceMonitor");
			const response = (
				byId("getLedgerAccountBalanceMonitor")?.responses["200"] as {
					content: Record<string, { schema: Schema }>;
				}
			).content["application/json"].schema;
			for (const request of [create, update]) {
				expect(request.properties?.webhook.properties?.url.format).toBe("uri");
				expect(request.properties?.webhook.properties?.signingSecret.writeOnly).toBe(true);
				expect(request.properties?.alertCondition.properties?.conditions.minItems).toBe(1);
			}
			expect(create.properties?.webhook.required).toEqual(["url", "signingSecret"]);
			expect(update.properties?.webhook.required).toEqual(["url"]);
			expect(Object.keys(response.properties?.webhook.properties ?? {})).toEqual(["url"]);
			expect(JSON.stringify(response)).not.toContain("signingSecret");
			expect(response.required).toEqual([
				"id",
				"accountId",
				"ledgerId",
				"alertCondition",
				"webhook",
				"lockVersion",
				"created",
				"updated",
			]);
		});
	});
});
