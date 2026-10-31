import { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { LedgerApi } from "@/api";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { LedgerAccountID, LedgerAccountStatementID, LedgerID, OrgID } from "@/lib/ids";
import { makeRequest, tokenFor, useTestWebHandlers } from "@/lib/testing";
import { encodeUuid } from "@/lib/utils";
import { calculateStatementBalances, LedgerAccountStatement } from "./LedgerAccountStatement";
import type { LedgerAccountStatementService as StatementServiceType } from "./LedgerAccountStatementService";
import { StatementPersistenceFailure } from "./StatementErrors";

const orgId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const accountId = new TypeID("lat") as LedgerAccountID;
const statementId = new TypeID("lst") as LedgerAccountStatementID;
const assetId = new TypeID("ast");
const base = `/api/ledgers/${ledgerId.toString()}/accounts/${accountId.toString()}/statements`;
const resource = `${base}/${statementId.toString()}`;
const body = {
	startDatetime: "2026-01-01T00:00:00.000Z",
	endDatetime: "2026-02-01T00:00:00.000Z",
	metadata: { period: "January" },
};
const idempotency = { "idempotency-key": "create" };
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
		startDatetime: new Date(body.startDatetime),
		endDatetime: new Date(body.endDatetime),
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
		metadata: body.metadata,
		lockVersion: 2,
		created: new Date(body.endDatetime),
		updated: new Date(body.endDatetime),
	})
);

const service = (): StatementServiceType =>
	vi.mocked<StatementServiceType>({
		getLedgerAccountStatement: vi.fn(() => Effect.succeed(stored)),
		createLedgerAccountStatement: vi.fn(() => Effect.succeed(stored)),
		listLedgerAccountStatements: vi.fn(() => Effect.succeed([stored])),
		getLedgerAccountStatementEntries: vi.fn(() => Effect.succeed([])),
		updateLedgerAccountStatement: vi.fn(() => Effect.succeed(stored)),
	} as unknown as StatementServiceType);

const buildHandler = useTestWebHandlers();
const build = (implementation: StatementServiceType) => buildHandler({ statement: implementation });
const tokenWith = tokenFor(orgId);
const request = makeRequest(() => tokenWith(["org_admin"]));

const routes: Array<[string, string, string, unknown, Record<string, string>]> = [
	["GET", base, "ledger:account:statement:read", undefined, {}],
	["GET", resource, "ledger:account:statement:read", undefined, {}],
	["GET", `${resource}/entries`, "ledger:account:statement:read", undefined, {}],
	["POST", base, "ledger:account:statement:write", body, idempotency],
	["PUT", resource, "ledger:account:statement:write", { lockVersion: 1 }, {}],
];

describe("Statement routes", () => {
	it("passes authenticated ownership and every path ID to scoped reads", async () => {
		const implementation = service();
		const response = await build(implementation)(request("GET", resource));
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json).toEqual(stored.toResponse());
		expect(implementation.getLedgerAccountStatement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			accountId,
			statementId
		);
		expect(json).toMatchObject({
			assetId: assetId.toString(),
			assetCode: "TOKENS",
			minorUnitExponent: 6,
		});
		expect(json).not.toHaveProperty("entries");
	});

	it("creates from path ownership with 200, no Location, and requires an idempotency key", async () => {
		const implementation = service();
		const handler = build(implementation);
		const missingKey = await handler(request("POST", base, { body }));
		expect(missingKey.status).toBe(400);
		expect(implementation.createLedgerAccountStatement).not.toHaveBeenCalled();
		const response = await handler(request("POST", base, { body, headers: idempotency }));
		expect(response.status).toBe(200);
		expect(response.headers.get("location")).toBeNull();
		expect(implementation.createLedgerAccountStatement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			accountId,
			"create",
			body
		);
	});

	it("returns arrays and forwards bounded pagination for both collections", async () => {
		const implementation = service();
		const handler = build(implementation);
		const listed = await handler(request("GET", `${base}?offset=2&limit=3`));
		const savedEntries = await handler(request("GET", `${resource}/entries`));
		expect(listed.status).toBe(200);
		expect(await listed.json()).toEqual([stored.toResponse()]);
		expect(savedEntries.status).toBe(200);
		expect(await savedEntries.json()).toEqual([]);
		expect(implementation.listLedgerAccountStatements).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			accountId,
			{ offset: 2, limit: 3 }
		);
		expect(implementation.getLedgerAccountStatementEntries).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			accountId,
			statementId,
			{ offset: 0, limit: 20 }
		);
		expect((await handler(request("GET", `${base}?limit=101`))).status).toBe(400);
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
			created: body.startDatetime,
			transaction: {
				id: new TypeID("ltr").toString(),
				lockVersion: 1,
				status: "posted" as const,
				effectiveAt: body.startDatetime,
			},
		};
		const implementation = service();
		vi
			.mocked(implementation.getLedgerAccountStatementEntries)
			.mockReturnValue(Effect.succeed([entry]));
		const response = await build(implementation)(request("GET", `${resource}/entries`));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([entry]);
	});

	it("requires an expected annotation version and maps stale versions to conflict", async () => {
		const implementation = service();
		vi
			.mocked(implementation.updateLedgerAccountStatement)
			.mockReturnValue(Effect.fail(new ConflictError("Stale annotations")));
		const handler = build(implementation);
		const missing = await handler(request("PUT", resource, { body: { description: "reviewed" } }));
		expect(missing.status).toBe(400);
		const stale = await handler(request("PUT", resource, { body: { lockVersion: 1 } }));
		expect(stale.status).toBe(409);
		expect(await stale.json()).toMatchObject({ type: "CONFLICT", detail: "Stale annotations" });
		expect(implementation.updateLedgerAccountStatement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			accountId,
			statementId,
			{ lockVersion: 1 }
		);
	});

	it("validates ownership IDs and timestamps and hides unexpected failures", async () => {
		const implementation = service();
		const handler = build(implementation);
		const invalidLedger = await handler(
			request("GET", `/api/ledgers/invalid/accounts/${accountId.toString()}/statements`)
		);
		expect(invalidLedger.status).toBe(400);
		const invalidTimestamp = await handler(
			request("POST", base, {
				body: { ...body, startDatetime: "yesterday" },
				headers: idempotency,
			})
		);
		expect(invalidTimestamp.status).toBe(400);
		expect(await invalidTimestamp.json()).toMatchObject({ type: "BAD_REQUEST" });

		vi
			.mocked(implementation.getLedgerAccountStatement)
			.mockReturnValueOnce(Effect.fail(new NotFoundError("Statement not found")))
			.mockReturnValueOnce(
				Effect.fail(new StatementPersistenceFailure(new Error("private database details")))
			);
		const missing = await handler(request("GET", resource));
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({
			type: "NOT_FOUND",
			detail: "Statement not found",
		});
		const failed = await handler(request("GET", resource));
		expect(failed.status).toBe(500);
		expect(await failed.text()).not.toContain("private database details");
	});

	it("sanitizes unexpected defects", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getLedgerAccountStatement)
			.mockReturnValue(Effect.die(new Error("secret detail")));
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
			async (method, path, permission, payload, headers) => {
				const implementation = service();
				const response = await build(implementation)(
					request(method, path, { token: tokenWith([]), body: payload, headers })
				);
				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({
					type: "FORBIDDEN",
					detail: `One of: ${permission}; permissions is required`,
				});
				for (const call of Object.values(implementation)) expect(call).not.toHaveBeenCalled();
			}
		);

		it("rejects anonymous reads and readonly writes", async () => {
			const implementation = service();
			const handler = build(implementation);
			expect((await handler(request("GET", base, { anonymous: true }))).status).toBe(401);
			const readonly = await handler(
				request("POST", base, {
					token: tokenWith(["org_readonly"]),
					body,
					headers: idempotency,
				})
			);
			expect(readonly.status).toBe(403);
			expect(implementation.createLedgerAccountStatement).not.toHaveBeenCalled();
		});
	});

	describe("OpenAPI", () => {
		type Operation = { operationId: string; tags?: string[]; responses: Record<string, object> };
		const spec = OpenApi.fromApi(LedgerApi);
		const groupOperationIds = [
			"listLedgerAccountStatements",
			"getLedgerAccountStatement",
			"getLedgerAccountStatementEntries",
			"createLedgerAccountStatement",
			"updateLedgerAccountStatement",
		];
		const operations = Object.values(spec.paths)
			.flatMap(path => Object.values(path ?? {}) as Operation[])
			.filter(operation => groupOperationIds.includes(operation.operationId));
		const byId = (id: string) => operations.find(operation => operation.operationId === id);

		it("documents all five operations at their published paths", () => {
			const root = "/api/ledgers/{ledgerId}/accounts/{accountId}/statements";
			expect(operations.map(operation => operation.operationId).sort()).toEqual(
				[...groupOperationIds].sort()
			);
			expect(spec.paths[`${root}/`]?.get?.operationId).toBe("listLedgerAccountStatements");
			expect(spec.paths[`${root}/`]?.post?.operationId).toBe("createLedgerAccountStatement");
			expect(spec.paths[`${root}/{statementId}`]?.get?.operationId).toBe("getLedgerAccountStatement");
			expect(spec.paths[`${root}/{statementId}`]?.put?.operationId).toBe(
				"updateLedgerAccountStatement"
			);
			expect(spec.paths[`${root}/{statementId}/entries`]?.get?.operationId).toBe(
				"getLedgerAccountStatementEntries"
			);
		});

		it("declares 409 on create and update only, with 429 on every route", () => {
			for (const operation of operations) expect(operation.responses).toHaveProperty("429");
			for (const id of ["createLedgerAccountStatement", "updateLedgerAccountStatement"])
				expect(byId(id)?.responses).toHaveProperty("409");
			for (const id of [
				"listLedgerAccountStatements",
				"getLedgerAccountStatement",
				"getLedgerAccountStatementEntries",
			])
				expect(byId(id)?.responses).not.toHaveProperty("409");
		});

		it("tags every operation and sets no Location header on create", () => {
			for (const operation of operations)
				expect(operation.tags).toEqual(["Ledger Account Statements"]);
			expect(byId("createLedgerAccountStatement")?.responses["200"]).not.toHaveProperty("headers");
		});
	});
});
