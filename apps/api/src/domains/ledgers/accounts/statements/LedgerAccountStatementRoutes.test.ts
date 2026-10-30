import { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { LedgerApi } from "@/api";
import { makeRequest, tokenFor, useTestWebHandlers } from "@/lib/testing";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { LedgerAccountID, LedgerAccountStatementID, LedgerID, OrgID } from "@/lib/ids";
import { LedgerAccountStatement } from "./LedgerAccountStatement";
import type { LedgerAccountStatementService } from "./LedgerAccountStatementService";

const ledgerId = TypeID.fromString<"lgr">("lgr_01h2x3y4z5a6b7c8d9e0f1g2h4") as LedgerID;
const pathAccountId = TypeID.fromString<"lat">("lat_01h2x3y4z5a6b7c8d9e0f1g2h6") as LedgerAccountID;
const bodyAccountId = TypeID.fromString<"lat">("lat_01h2x3y4z5a6b7c8d9e0f1g2h8") as LedgerAccountID;
const asset = { assetId: new TypeID("ast").toString(), assetCode: "AAPL", minorUnitExponent: 6 };
const statementId = TypeID.fromString<"lst">(
	"lst_01h2x3y4z5a6b7c8d9e0f1g2h5"
) as LedgerAccountStatementID;
const fixedDate = new Date("2025-01-01T00:00:00.000Z");
const orgId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;

const statement = new LedgerAccountStatement({
	asset,
	id: statementId,
	ledgerId,
	accountId: bodyAccountId,
	statementDate: fixedDate,
	openingBalance: 0n,
	closingBalance: 0n,
	totalCredits: 0n,
	totalDebits: 0n,
	transactionCount: 0,
	created: fixedDate,
	updated: fixedDate,
});

const service = (): LedgerAccountStatementService =>
	vi.mocked<LedgerAccountStatementService>({
		getLedgerAccountStatement: vi.fn(() => Effect.succeed(statement)),
		createLedgerAccountStatement: vi.fn(() => Effect.succeed(statement)),
	} as unknown as LedgerAccountStatementService);

const buildHandler = useTestWebHandlers();
const build = (implementation: LedgerAccountStatementService) => {
	return buildHandler({ statement: implementation });
};
const tokenWith = tokenFor(orgId);
const request = makeRequest(() => tokenWith(["org_admin"]));

const base = `/api/ledgers/${ledgerId.toString()}/accounts/${pathAccountId.toString()}/statements`;
const resource = `${base}/${statementId.toString()}`;
const payload = {
	ledgerId: ledgerId.toString(),
	accountId: bodyAccountId.toString(),
	description: "Test statement",
	startDatetime: fixedDate.toISOString(),
	endDatetime: "2025-02-01T00:00:00.000Z",
};
const routes: Array<[string, string, string, unknown]> = [
	["GET", resource, "ledger:account:statement:read", undefined],
	["POST", base, "ledger:account:statement:write", payload],
];

describe("Statement routes", () => {
	it("gets by statement ID alone and ignores the enclosing path IDs", async () => {
		const implementation = service();
		const unrelated = `/api/ledgers/${new TypeID("lgr").toString()}/accounts/not-an-id/statements/${statementId.toString()}`;
		const response = await build(implementation)(request("GET", unrelated));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(statement.toResponse());
		expect(implementation.getLedgerAccountStatement).toHaveBeenCalledWith(
			statementId.toString(),
			orgId
		);
	});

	it("creates from the body with 200, no Location, and ignores the path IDs", async () => {
		const implementation = service();
		const response = await build(implementation)(
			request("POST", `/api/ledgers/${new TypeID("lgr").toString()}/accounts/other/statements`, {
				body: payload,
			})
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("location")).toBeNull();
		expect(await response.json()).toEqual(statement.toResponse());
		expect(implementation.createLedgerAccountStatement).toHaveBeenCalledWith(payload, orgId);
	});

	it("accepts the collection path with a trailing slash", async () => {
		const response = await build(service())(request("POST", `${base}/`, { body: payload }));
		expect(response.status).toBe(200);
	});

	it("preserves metadata key-value pairs on the wire", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getLedgerAccountStatement)
			.mockReturnValue(
				Effect.succeed(new LedgerAccountStatement({ ...statement, metadata: { period: "monthly" } }))
			);
		const response = await build(implementation)(request("GET", resource));
		const json = (await response.json()) as { metadata?: Record<string, string> };
		expect(json.metadata).toEqual({ period: "monthly" });
	});

	it("omits description and metadata when the statement has none", async () => {
		const response = await build(service())(request("GET", resource));
		const json = (await response.json()) as Record<string, unknown>;
		expect(json).not.toHaveProperty("description");
		expect(json).not.toHaveProperty("metadata");
	});

	it("requires authentication", async () => {
		const implementation = service();
		const response = await build(implementation)(request("GET", resource, { anonymous: true }));
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ type: "UNAUTHORIZED", detail: "Invalid token" });
		expect(implementation.getLedgerAccountStatement).not.toHaveBeenCalled();
	});

	it("rejects readonly writes", async () => {
		const implementation = service();
		const response = await build(implementation)(
			request("POST", base, { token: tokenWith(["org_readonly"]), body: payload })
		);
		expect(response.status).toBe(403);
		expect(implementation.createLedgerAccountStatement).not.toHaveBeenCalled();
	});

	it("rejects an invalid statement ID with a BAD_REQUEST problem", async () => {
		const implementation = service();
		const response = await build(implementation)(request("GET", `${base}/invalid`));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
		expect(implementation.getLedgerAccountStatement).not.toHaveBeenCalled();
	});

	it("rejects an invalid body with a BAD_REQUEST problem", async () => {
		const implementation = service();
		const response = await build(implementation)(
			request("POST", base, { body: { ...payload, accountId: "nope" } })
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST" });
		expect(implementation.createLedgerAccountStatement).not.toHaveBeenCalled();
	});

	it("translates typed failures", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getLedgerAccountStatement)
			.mockReturnValue(Effect.fail(new NotFoundError("Statement not found")));
		vi
			.mocked(implementation.createLedgerAccountStatement)
			// Create declares 409 for the OpenAPI contract, but no service path produces it.
			.mockReturnValue(Effect.fail(new ConflictError("Statement already exists")) as never);
		const handler = build(implementation);
		const missing = await handler(request("GET", resource));
		const conflict = await handler(request("POST", base, { body: payload }));
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({ type: "NOT_FOUND", detail: "Statement not found" });
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toMatchObject({
			type: "CONFLICT",
			detail: "Statement already exists",
		});
	});

	it("sanitizes unexpected service failures", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getLedgerAccountStatement)
			.mockReturnValue(Effect.fail(new Error("database details")) as never);
		const response = await build(implementation)(request("GET", resource));
		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			type: "INTERNAL_SERVER_ERROR",
			status: 500,
			detail: "Internal Server Error",
		});
	});

	it("renders a bad statement ID defect as a sanitized 500", async () => {
		// The service parses the ID inside Effect.sync, so a parse failure is a defect.
		const implementation = service();
		vi
			.mocked(implementation.getLedgerAccountStatement)
			.mockReturnValue(Effect.die(new Error("Invalid TypeID: secret detail")));
		const response = await build(implementation)(request("GET", resource));
		expect(response.status).toBe(500);
		const text = await response.text();
		expect(JSON.parse(text)).toMatchObject({
			type: "INTERNAL_SERVER_ERROR",
			detail: "Internal Server Error",
		});
		expect(text).not.toContain("secret detail");
	});

	describe("authorization", () => {
		it.each(routes)(
			"returns 403 on %s %s for a token without scope",
			async (method, path, permission, body) => {
				const implementation = service();
				const response = await build(implementation)(
					request(method, path, { token: tokenWith([]), body })
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
		type Operation = { operationId: string; tags?: string[]; responses: Record<string, object> };
		const spec = OpenApi.fromApi(LedgerApi);
		const groupOperationIds = ["getLedgerAccountStatement", "createLedgerAccountStatement"];
		const operations = Object.values(spec.paths)
			.flatMap(path => Object.values(path ?? {}) as Operation[])
			.filter(operation => groupOperationIds.includes(operation.operationId));
		const byId = (id: string) => operations.find(operation => operation.operationId === id);

		it("preserves the existing OpenAPI operations and response sets", () => {
			const prefix = "/api/ledgers/{ledgerId}/accounts/{accountId}/statements";
			expect({
				get: spec.paths[`${prefix}/{statementId}`]?.get,
				post: spec.paths[`${prefix}/`]?.post,
				LedgerAccountStatementRequest: spec.components.schemas.LedgerAccountStatementRequest,
				LedgerAccountStatementResponse: spec.components.schemas.LedgerAccountStatementResponse,
			}).toMatchSnapshot();
			expect(operations.map(operation => operation.operationId).sort()).toEqual(
				[...groupOperationIds].sort()
			);
			expect(Object.keys(byId("getLedgerAccountStatement")?.responses ?? {})).toEqual([
				"200",
				"400",
				"401",
				"403",
				"404",
				"429",
				"500",
				"503",
			]);
			expect(Object.keys(byId("createLedgerAccountStatement")?.responses ?? {})).toEqual([
				"200",
				"400",
				"401",
				"403",
				"404",
				"409",
				"429",
				"500",
				"503",
			]);
		});

		it("keeps the legacy component schemas for the request and response", () => {
			const schemas = spec.components.schemas as unknown as Record<
				string,
				{
					required: string[];
					properties: Record<string, { type?: string; pattern?: string }>;
					additionalProperties?: unknown;
				}
			>;
			const response = schemas.LedgerAccountStatementResponse;
			const request = schemas.LedgerAccountStatementRequest;
			expect(response.required).toEqual([
				"id",
				"ledgerId",
				"accountId",
				"startDatetime",
				"endDatetime",
				"ledgerAccountVersion",
				"normalBalance",
				"assetId",
				"assetCode",
				"minorUnitExponent",
				"created",
				"updated",
			]);
			expect(response.properties.ledgerAccountVersion.type).toBe("number");
			expect(response.properties.id.pattern).toBe("^lst_[0-7][0-9a-hjkmnp-tv-z]{25}$");
			expect(request.required).toEqual(["ledgerId", "accountId", "startDatetime", "endDatetime"]);
			expect(request.properties.startDatetime).not.toHaveProperty("format");
		});

		it("tags both operations and sets no Location header on create", () => {
			for (const operation of operations)
				expect(operation.tags).toEqual(["Ledger Account Statements"]);
			expect(byId("createLedgerAccountStatement")?.responses["200"]).not.toHaveProperty("headers");
		});
	});
});
