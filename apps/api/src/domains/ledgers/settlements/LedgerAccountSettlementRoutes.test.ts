import type { FastifyInstance } from "fastify";
import { Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signJWT } from "@/auth";
import { Config } from "@/config";
import { makeDatabaseLive } from "@/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { buildServer } from "@/server";
import { ServerConfigTag, type ServerRuntimeLayer } from "@/runtime";
import type { LedgerAccountSettlementResponse } from "./LedgerAccountSettlementSchema";
import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import {
	type LedgerAccountSettlementService,
	LedgerAccountSettlementServiceTag,
} from "./LedgerAccountSettlementService";

const service = {
	listLedgerAccountSettlements:
		vi.fn<LedgerAccountSettlementService["listLedgerAccountSettlements"]>(),
	getLedgerAccountSettlement: vi.fn<LedgerAccountSettlementService["getLedgerAccountSettlement"]>(),
	createLedgerAccountSettlement:
		vi.fn<LedgerAccountSettlementService["createLedgerAccountSettlement"]>(),
	patchLedgerAccountSettlement:
		vi.fn<LedgerAccountSettlementService["patchLedgerAccountSettlement"]>(),
	addLedgerAccountSettlementEntries:
		vi.fn<LedgerAccountSettlementService["addLedgerAccountSettlementEntries"]>(),
	removeLedgerAccountSettlementEntries:
		vi.fn<LedgerAccountSettlementService["removeLedgerAccountSettlementEntries"]>(),
	listLedgerAccountSettlementEntries:
		vi.fn<LedgerAccountSettlementService["listLedgerAccountSettlementEntries"]>(),
};
const orgId = new TypeID("org");
const ledgerId = new TypeID("lgr");
const settlementId = new TypeID("las");
const settledAccountId = new TypeID("lat");
const contraAccountId = new TypeID("lat");
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
const auth = {
	authorization: `Bearer ${signJWT({ sub: orgId.toString(), scope: ["org_admin"] })}`,
};
const userAuth = {
	authorization: `Bearer ${signJWT({ sub: orgId.toString(), scope: ["org_user"] })}`,
};
const readAuth = {
	authorization: `Bearer ${signJWT({ sub: orgId.toString(), scope: ["org_readonly"] })}`,
};
let headers: Record<string, string>;

describe("Settlement routes", () => {
	let server: FastifyInstance;
	beforeAll(async () => {
		const config = new Config();
		server = await buildServer({
			runtimeLayer: Layer.mergeAll(
				Layer.succeed(ServerConfigTag, config),
				makeDatabaseLive(config.databaseUrl),
				Layer.succeed(
					LedgerAccountSettlementServiceTag,
					service as unknown as LedgerAccountSettlementService
				)
			) as ServerRuntimeLayer,
		});
	});
	afterAll(async () => {
		await server.close();
	});
	beforeEach(() => {
		vi.resetAllMocks();
		headers = { ...auth, "idempotency-key": crypto.randomUUID() };
	});

	it("creates a draft and returns its Location", async () => {
		service.createLedgerAccountSettlement.mockReturnValue(Effect.succeed(settlement));
		const response = await server.inject({ method: "POST", url: base, headers, payload });
		expect(response.statusCode).toBe(201);
		expect(response.headers.location).toBe(resource);
		expect(response.json()).toMatchObject({
			id: settlementId.toString(),
			ledgerId: ledgerId.toString(),
		});
		expect(response.json<LedgerAccountSettlementResponse>().transactionId).toBeNull();
		expect(response.json<LedgerAccountSettlementResponse>().amount).toBeNull();
		expect(response.json<LedgerAccountSettlementResponse>().settlementEntryDirection).toBeNull();
		expect(service.createLedgerAccountSettlement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			headers["idempotency-key"],
			expect.objectContaining(payload)
		);
	});
	it("applies create defaults", async () => {
		service.createLedgerAccountSettlement.mockReturnValue(Effect.succeed(settlement));
		const response = await server.inject({
			method: "POST",
			url: base,
			headers,
			payload: {
				settledAccountId: payload.settledAccountId,
				contraAccountId: payload.contraAccountId,
			},
		});
		expect(response.statusCode).toBe(201);
		expect(service.createLedgerAccountSettlement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			headers["idempotency-key"],
			expect.objectContaining({ status: "pending", allowEitherDirection: false })
		);
	});
	it("scopes listing and forwards pagination", async () => {
		service.listLedgerAccountSettlements.mockReturnValue(Effect.succeed([settlement]));
		const response = await server.inject({
			method: "GET",
			url: `${base}?offset=10&limit=5`,
			headers: auth,
		});
		expect(response.statusCode).toBe(200);
		expect(service.listLedgerAccountSettlements).toHaveBeenCalledWith(orgId, ledgerId, 10, 5);
	});
	it("scopes individual lookup to the path Ledger", async () => {
		const other = new TypeID("lgr");
		service.getLedgerAccountSettlement.mockReturnValue(
			Effect.fail(new NotFoundError("Settlement not found"))
		);
		const response = await server.inject({
			method: "GET",
			url: `/api/ledgers/${other.toString()}/settlements/${settlementId.toString()}`,
			headers: auth,
		});
		expect(response.statusCode).toBe(404);
		expect(service.getLedgerAccountSettlement).toHaveBeenCalledWith(orgId, other, settlementId);
	});
	it("patches metadata and status with the full scope", async () => {
		service.patchLedgerAccountSettlement.mockReturnValue(Effect.succeed(settlement));
		const patch = { status: "pending", metadata: { batch: "daily" } };
		const response = await server.inject({
			method: "PATCH",
			url: resource,
			headers: { ...headers, ...userAuth },
			payload: patch,
		});
		expect(response.statusCode).toBe(200);
		expect(service.patchLedgerAccountSettlement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			settlementId,
			headers["idempotency-key"],
			patch
		);
	});
	it("requires delete permission in addition to write for voiding", async () => {
		service.patchLedgerAccountSettlement.mockReturnValue(Effect.succeed(settlement));
		const response = await server.inject({
			method: "PATCH",
			url: resource,
			headers: { ...headers, ...userAuth },
			payload: { status: "voided" },
		});
		expect(response.statusCode).toBe(403);
		expect(service.patchLedgerAccountSettlement).not.toHaveBeenCalled();
		const allowed = await server.inject({
			method: "PATCH",
			url: resource,
			headers,
			payload: { status: "voided" },
		});
		expect(allowed.statusCode).toBe(200);
	});
	it.each(["PATCH", "DELETE"] as const)(
		"%s membership returns 204 and forwards scope",
		async method => {
			const mock =
				method === "PATCH"
					? service.addLedgerAccountSettlementEntries
					: service.removeLedgerAccountSettlementEntries;
			mock.mockReturnValue(Effect.void);
			const entries = [new TypeID("lte").toString()];
			const response = await server.inject({
				method,
				url: `${resource}/entries`,
				headers,
				payload: { entries },
			});
			expect(response.statusCode).toBe(204);
			expect(response.body).toBe("");
			expect(mock).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				settlementId,
				headers["idempotency-key"],
				entries
			);
		}
	);
	it("lists sources with default pagination and read permission", async () => {
		service.listLedgerAccountSettlementEntries.mockReturnValue(Effect.succeed([]));
		const response = await server.inject({
			method: "GET",
			url: `${resource}/entries`,
			headers: readAuth,
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([]);
		expect(service.listLedgerAccountSettlementEntries).toHaveBeenCalledWith(
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
			for (const url of [base, `${resource}/entries`])
				expect(
					(await server.inject({ method: "GET", url: `${url}?${query}`, headers: auth })).statusCode
				).toBe(400);
			expect(service.listLedgerAccountSettlements).not.toHaveBeenCalled();
			expect(service.listLedgerAccountSettlementEntries).not.toHaveBeenCalled();
		}
	);
	it.each(
		[[], ["invalid"], Array.from({ length: 501 }, () => new TypeID("lte").toString())].map(
			entries => ({ entries })
		)
	)("rejects invalid membership input %#", async ({ entries }) => {
		const response = await server.inject({
			method: "PATCH",
			url: `${resource}/entries`,
			headers,
			payload: { entries },
		});
		expect(response.statusCode).toBe(400);
		expect(service.addLedgerAccountSettlementEntries).not.toHaveBeenCalled();
	});
	it.each(["drafting", "processing", "invalid"])("rejects client patch status %s", async status => {
		expect(
			(await server.inject({ method: "PATCH", url: resource, headers, payload: { status } }))
				.statusCode
		).toBe(400);
		expect(service.patchLedgerAccountSettlement).not.toHaveBeenCalled();
	});
	it("requires a client key on mutations", async () => {
		expect(
			(await server.inject({ method: "POST", url: base, headers: auth, payload })).statusCode
		).toBe(400);
		expect(service.createLedgerAccountSettlement).not.toHaveBeenCalled();
	});
	it("rejects readonly writes", async () => {
		expect(
			(
				await server.inject({
					method: "POST",
					url: base,
					headers: { ...headers, ...readAuth },
					payload,
				})
			).statusCode
		).toBe(403);
		expect(service.createLedgerAccountSettlement).not.toHaveBeenCalled();
	});
	it("requires authentication", async () => {
		expect((await server.inject({ method: "GET", url: base })).statusCode).toBe(401);
	});
	it.each(["PUT", "DELETE"] as const)("removes resource %s", async method => {
		expect((await server.inject({ method, url: resource, headers, payload })).statusCode).toBe(404);
	});
	it("removes status POST", async () => {
		expect(
			(await server.inject({ method: "POST", url: `${resource}/pending`, headers })).statusCode
		).toBe(404);
	});
	it("translates a service conflict", async () => {
		service.patchLedgerAccountSettlement.mockReturnValue(
			Effect.fail(new ConflictError("Cannot change a posted Settlement"))
		);
		expect(
			(await server.inject({ method: "PATCH", url: resource, headers, payload: { status: "voided" } }))
				.statusCode
		).toBe(409);
	});
});
