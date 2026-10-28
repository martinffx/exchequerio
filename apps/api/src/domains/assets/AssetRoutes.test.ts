import { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { LedgerApi } from "@/api";
import { makeRequest, tokenFor, useTestWebHandlers } from "@/lib/testing";
import type { OrgID } from "@/lib/ids";
import { Asset } from "./Asset";
import type { AssetService } from "./AssetService";

const orgId = new TypeID("org") as OrgID;
const asset = Asset.fromRequest(
	TypeID.fromString("ast_01h2x3y4z5a6b7c8d9e0f1g2h4", "ast"),
	orgId,
	{ code: "USD", name: "Dollar", minorUnitExponent: 2, metadata: { source: "manual" } },
	DateTime.fromISO("2026-09-10T12:34:56.789Z", { zone: "utc" })
);
const assetPath = `/api/assets/${asset.id.toString()}`;
const createDetail = "Invalid Asset creation request";
const replaceDetail = "Invalid Asset replacement request";

const service = (): AssetService =>
	vi.mocked<AssetService>({
		listAssets: vi.fn(() => Effect.succeed([asset])),
		getAsset: vi.fn(() => Effect.succeed(asset)),
		createAsset: vi.fn(() => Effect.succeed(asset)),
		updateAsset: vi.fn(() => Effect.succeed(asset)),
		deleteAsset: vi.fn(() => Effect.void),
	} as unknown as AssetService);

const buildHandler = useTestWebHandlers();
const build = (implementation: AssetService) => {
	return buildHandler({ asset: implementation });
};
const tokenWith = tokenFor(orgId);
const request = makeRequest(() => tokenWith(["super_admin"]));

const routes: Array<[string, string, string, unknown]> = [
	["GET", "/api/assets", "asset:read", undefined],
	["GET", assetPath, "asset:read", undefined],
	["POST", "/api/assets", "asset:write", { code: "USD", name: "Dollar", minorUnitExponent: 2 }],
	["PUT", assetPath, "asset:write", { code: "USD", name: "Dollar" }],
	["DELETE", assetPath, "asset:delete", undefined],
];

describe("Asset HTTP contract", () => {
	it.each([
		{ code: "BAD CODE", name: "Invalid", minorUnitExponent: 2 },
		{ code: "", name: "Invalid", minorUnitExponent: 2 },
		{ code: "USD", name: "   ", minorUnitExponent: 2 },
		{ code: "X".repeat(65), name: "Invalid", minorUnitExponent: 2 },
		{ code: "USD", name: "Invalid" },
		{ code: "USD", name: "Invalid", minorUnitExponent: -1 },
		{ code: "USD", name: "Invalid", minorUnitExponent: 19 },
		{ code: "USD", name: "Invalid", minorUnitExponent: 2.5 },
		{ code: "USD", name: "Invalid", minorUnitExponent: "2" },
		{ code: "USD", name: "Invalid", minorUnitExponent: 2, metadata: { count: 1 } },
		{ code: "USD", name: "Dollar", minorUnitExponent: 2, unknown: true },
	])("rejects invalid creation input %#", async body => {
		const implementation = service();
		const response = await build(implementation)(request("POST", "/api/assets", { body }));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", detail: createDetail });
		expect(implementation.createAsset).not.toHaveBeenCalled();
	});

	it.each([
		{ code: "USD", name: "   " },
		{ code: "USD", name: "Dollar", unknown: true },
	])("rejects invalid replacement input %#", async body => {
		const implementation = service();
		const response = await build(implementation)(request("PUT", assetPath, { body }));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", detail: replaceDetail });
		expect(implementation.updateAsset).not.toHaveBeenCalled();
	});

	it("serializes domain fields without changing the HTTP representation", async () => {
		const response = await build(service())(
			request("POST", "/api/assets", {
				body: { code: "USD", name: "Dollar", minorUnitExponent: 2, metadata: { source: "manual" } },
			})
		);
		expect(response.status).toBe(201);
		expect(response.headers.get("location")).toBe(`/api/assets/${asset.id.toString()}`);
		expect(await response.json()).toEqual({
			id: "ast_01h2x3y4z5a6b7c8d9e0f1g2h4",
			code: "USD",
			name: "Dollar",
			minorUnitExponent: 2,
			metadata: { source: "manual" },
			created: "2026-09-10T12:34:56.789Z",
			updated: "2026-09-10T12:34:56.789Z",
		});
	});

	it("passes a typed Asset ID to the update service", async () => {
		const implementation = service();
		const payload = { code: "USD.NEW", name: "Dollar" };
		const response = await build(implementation)(request("PUT", assetPath, { body: payload }));
		expect(response.status).toBe(200);
		expect(implementation.updateAsset).toHaveBeenCalledWith(orgId, asset.id, payload);
	});

	it("rejects replacement of immutable fields", async () => {
		const implementation = service();
		const response = await build(implementation)(
			request("PUT", assetPath, { body: { code: "USD", name: "Dollar", minorUnitExponent: 3 } })
		);
		expect(response.status).toBe(400);
		expect(implementation.updateAsset).not.toHaveBeenCalled();
	});

	it("generates OpenAPI from schemas", () => {
		const spec = OpenApi.fromApi(LedgerApi);
		const operation = (spec.paths["/api/assets/"] as unknown as Record<string, { responses: object }>)
			.post;
		expect(operation.responses).toHaveProperty("409");
		expect(JSON.stringify(operation)).toContain("minorUnitExponent");
	});

	it.each(["offset=10001", "limit=0"])("rejects invalid pagination %s", async query => {
		const implementation = service();
		const response = await build(implementation)(request("GET", `/api/assets?${query}`));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
		expect(implementation.listAssets).not.toHaveBeenCalled();
	});

	it("passes tenant scope and pagination defaults to list", async () => {
		const implementation = service();
		const response = await build(implementation)(request("GET", "/api/assets?code=usd"));
		expect(response.status).toBe(200);
		expect(implementation.listAssets).toHaveBeenCalledWith(orgId, {
			offset: 0,
			limit: 20,
			code: "usd",
		});
	});

	it("returns 401 without a token", async () => {
		const implementation = service();
		const response = await build(implementation)(request("GET", "/api/assets", { anonymous: true }));
		expect(response.status).toBe(401);
		expect(implementation.listAssets).not.toHaveBeenCalled();
	});

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

	it("deletes with an empty 204", async () => {
		const implementation = service();
		const response = await build(implementation)(request("DELETE", assetPath));
		expect(response.status).toBe(204);
		expect(implementation.deleteAsset).toHaveBeenCalledWith(orgId, asset.id);
	});
});
