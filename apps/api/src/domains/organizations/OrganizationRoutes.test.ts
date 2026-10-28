import { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { LedgerApi } from "@/api";
import { makeRequest, useTestWebHandlers } from "@/lib/testing";
import { signJWT } from "@/auth";
import type { OrgID } from "@/lib/ids";
import { Organization } from "./Organization";
import { OrganizationNotFound } from "./OrganizationErrors";
import type { OrganizationService } from "./OrganizationService";

const organizationId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
const organization = Organization.fromRequest(organizationId, {
	name: "Example",
});

const service = (): OrganizationService =>
	vi.mocked<OrganizationService>({
		listOrganizations: vi.fn(() => Effect.succeed([organization])),
		getOrganization: vi.fn(() => Effect.succeed(organization)),
		createOrganization: vi.fn(() => Effect.succeed(organization)),
		updateOrganization: vi.fn(() => Effect.succeed(organization)),
		deleteOrganization: vi.fn(() => Effect.succeed(organization)),
	} as unknown as OrganizationService);

const buildHandler = useTestWebHandlers();

const build = (implementation: OrganizationService) => {
	return buildHandler({ organization: implementation });
};

const superAdmin = () => signJWT({ sub: organizationId.toString(), scope: ["super_admin"] });
const request = makeRequest(superAdmin);

const orgPath = `/api/organizations/${organizationId.toString()}`;
const routes: Array<[string, string, string, unknown]> = [
	["GET", "/api/organizations", "organization:read", undefined],
	["GET", orgPath, "organization:read", undefined],
	["POST", "/api/organizations", "organization:write", { name: "Example" }],
	["PUT", orgPath, "organization:write", { name: "Example" }],
	["DELETE", orgPath, "organization:delete", undefined],
];

describe("OrganizationRoutes", () => {
	it("lists Organizations with defaulted pagination", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(request("GET", "/api/organizations"));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject([{ id: organizationId.toString(), name: "Example" }]);
		expect(implementation.listOrganizations).toHaveBeenCalledWith({ offset: 0, limit: 20 });
	});

	it("coerces pagination query strings to integers", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(request("GET", "/api/organizations?offset=5&limit=10"));

		expect(response.status).toBe(200);
		expect(implementation.listOrganizations).toHaveBeenCalledWith({ offset: 5, limit: 10 });
	});

	it("creates through the Effect service with 201 and Location", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(
			request("POST", "/api/organizations", { body: { name: "Example" } })
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("location")).toBe(`/api/organizations/${organizationId.toString()}`);
		const body = await response.json();
		expect(body).toMatchObject({ id: organizationId.toString(), name: "Example" });
		expect(body).not.toHaveProperty("description");
		expect(implementation.createOrganization).toHaveBeenCalledWith({ name: "Example" });
	});

	it("deletes through the Effect service with an empty 204 response", async () => {
		const implementation = service();
		const handler = build(implementation);

		const response = await handler(request("DELETE", orgPath));

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
		expect(implementation.deleteOrganization).toHaveBeenCalledWith(organizationId);
	});

	it("maps permitted absence through the Effect boundary", async () => {
		const implementation = service();
		vi
			.mocked(implementation.getOrganization)
			.mockReturnValue(Effect.fail(new OrganizationNotFound()));
		const handler = build(implementation);

		const response = await handler(request("GET", orgPath));

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ type: "NOT_FOUND", status: 404 });
	});

	it("rejects a malformed Organization ID with a 400 problem", async () => {
		const handler = build(service());

		const response = await handler(request("GET", "/api/organizations/org_bad"));

		expect(response.status).toBe(400);
	});

	describe("authentication", () => {
		it.each([
			["a missing header", { anonymous: true }],
			["a bad signature", { token: `${superAdmin().slice(0, -3)}abc` }],
			[
				"a non-Organization subject",
				{ token: signJWT({ sub: "user_01h2x3y4z5a6b7c8d9e0f1g2h3", scope: ["super_admin"] }) },
			],
		])("returns 401 Invalid token for %s", async (_name, credentials) => {
			const handler = build(service());

			const response = await handler(request("GET", orgPath, credentials));

			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({
				type: "UNAUTHORIZED",
				status: 401,
				detail: "Invalid token",
			});
		});

		it("returns 401 before validating an unauthenticated invalid body", async () => {
			const handler = build(service());

			const response = await handler(
				request("POST", "/api/organizations", { anonymous: true, body: { name: 123 } })
			);

			expect(response.status).toBe(401);
		});
	});

	describe("authorization", () => {
		it.each(routes)(
			"returns 403 on %s %s for a token without scope",
			async (method, path, permission, body) => {
				const implementation = service();
				const handler = build(implementation);
				const token = signJWT({ sub: organizationId.toString(), scope: [] });

				const response = await handler(request(method, path, { token, body }));

				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({
					type: "FORBIDDEN",
					detail: `One of: ${permission}; permissions is required`,
				});
				expect(implementation.listOrganizations).not.toHaveBeenCalled();
				expect(implementation.deleteOrganization).not.toHaveBeenCalled();
			}
		);

		it.each(routes)("returns 403 on %s %s for org_admin", async (method, path, _permission, body) => {
			const handler = build(service());
			const token = signJWT({ sub: organizationId.toString(), scope: ["org_admin"] });

			const response = await handler(request(method, path, { token, body }));

			expect(response.status).toBe(403);
		});
	});

	describe("OpenAPI", () => {
		const spec = OpenApi.fromApi(LedgerApi);

		it("documents the five Organization operations under the Organizations tag", () => {
			const operations = Object.entries(spec.paths)
				.filter(([route]) => route.startsWith("/api/organizations"))
				.flatMap(([, path]) =>
					Object.values(path ?? {}).filter(operation => !Array.isArray(operation))
				) as Array<{
				operationId: string;
				tags: string[];
			}>;

			expect(operations.map(operation => operation.operationId).sort()).toEqual([
				"createOrganization",
				"deleteOrganization",
				"getOrganization",
				"listOrganizations",
				"updateOrganization",
			]);
			for (const operation of operations) expect(operation.tags).toEqual(["Organizations"]);
		});

		it("documents the list offset and limit as optional integers", () => {
			const list = (spec.paths["/api/organizations/"] as unknown as Record<string, unknown>).get as {
				parameters: Array<{ name: string; in: string; required: boolean; schema: object }>;
			};
			const parameter = (name: string) => list.parameters.find(entry => entry.name === name);
			expect(parameter("offset")).toMatchObject({ in: "query", required: false });
			expect(parameter("limit")).toMatchObject({ in: "query", required: false });
		});

		it("documents problem responses without nullable optional fields", () => {
			const responses = (
				spec.paths["/api/organizations/{orgId}"] as unknown as Record<
					string,
					{ responses: Record<string, unknown> }
				>
			).delete.responses;
			const conflict = responses["409"] as {
				content: {
					"application/json": { schema: { properties: Record<string, unknown>; required: string[] } };
				};
				headers: Record<string, { required: boolean }>;
			};
			const body = conflict.content["application/json"].schema;
			expect(body.properties.retryable).toEqual({ type: "boolean" });
			expect(body.required).not.toContain("retryable");
			expect(conflict.headers["retry-after"]?.required).toBe(false);
		});

		it("keeps the collection path key and the per-route status sets", () => {
			expect(Object.keys(spec.paths)).toContain("/api/organizations/");
			const statuses = (path: string, method: "get" | "post" | "put" | "delete") =>
				Object.keys(
					(spec.paths[path] as unknown as Record<string, { responses: object }>)[method].responses
				).sort();
			const common = ["400", "401", "403", "500", "503"];
			const expected = (...codes: string[]) => [...codes, ...common].sort();

			expect(statuses("/api/organizations/", "get")).toEqual(expected("200"));
			expect(statuses("/api/organizations/", "post")).toEqual(expected("201"));
			expect(statuses("/api/organizations/{orgId}", "get")).toEqual(expected("200", "404"));
			expect(statuses("/api/organizations/{orgId}", "put")).toEqual(expected("200", "404"));
			expect(statuses("/api/organizations/{orgId}", "delete")).toEqual(expected("204", "404", "409"));
		});
	});
});
