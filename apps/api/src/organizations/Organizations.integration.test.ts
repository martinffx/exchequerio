import { afterEach, describe, expect, it } from "vitest";
import type { ApiTestHarness } from "../testing/ApiTestHarness";
import { createApiTestHarness } from "../testing/ApiTestHarness";
import { TypeID } from "typeid-js";

let harness: ApiTestHarness | undefined;

const useHarness = async () => (harness ??= await createApiTestHarness());

afterEach(async () => {
	const currentHarness = harness;
	harness = undefined;
	if (currentHarness !== undefined) await currentHarness.close();
});

describe.sequential("Organizations HTTP to PostgreSQL", () => {
	it("publishes the Organization HTTP contract from the assembled server", async () => {
		const api = await useHarness();
		const pressureStatus = await api.server.inject({ method: "GET", url: "/status" });
		const response = await api.server.inject({ method: "GET", url: "/docs/json" });
		expect(pressureStatus.statusCode).toBe(404);
		expect(response.statusCode).toBe(200);
		const document = response.json<{
			paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
		}>();

		expect(document.paths["/api/organizations/"]?.post?.responses).toHaveProperty("201");
		expect(document.paths["/api/organizations/"]?.post?.responses).not.toHaveProperty("409");
		expect(document.paths["/api/organizations/{orgId}"]?.delete?.responses).toHaveProperty("204");
		expect(document.paths["/api/organizations/{orgId}"]?.delete?.responses).toHaveProperty("409");
	});

	it("executes one assembled CRUD journey", async () => {
		const api = await useHarness();
		const actorId = await api.createOrganization("Platform actor");
		const authorization = `Bearer ${api.token(actorId)}`;

		const created = await api.server.inject({
			method: "POST",
			url: "/api/organizations",
			headers: { authorization },
			payload: { name: "Journey", description: "Keep me" },
		});
		expect(created.statusCode).toBe(201);
		const createdBody = created.json<{ id: string; name: string; description: string }>();
		api.rememberOrganization(createdBody.id);
		expect(created.headers.location).toBe(`/api/organizations/${createdBody.id}`);

		const found = await api.server.inject({
			method: "GET",
			url: `/api/organizations/${createdBody.id}`,
			headers: { authorization },
		});
		expect(found.json()).toMatchObject({ id: createdBody.id, description: "Keep me" });

		const updated = await api.server.inject({
			method: "PUT",
			url: `/api/organizations/${createdBody.id}`,
			headers: { authorization },
			payload: { name: "Journey updated" },
		});
		expect(updated.json()).toMatchObject({
			id: createdBody.id,
			name: "Journey updated",
			description: "Keep me",
		});

		const listed = await api.server.inject({
			method: "GET",
			url: "/api/organizations?offset=0&limit=100",
			headers: { authorization },
		});
		expect(listed.json<Array<{ id: string }>>().some(item => item.id === createdBody.id)).toBe(true);

		const deleted = await api.server.inject({
			method: "DELETE",
			url: `/api/organizations/${createdBody.id}`,
			headers: { authorization },
		});
		expect(deleted.statusCode).toBe(204);
		expect(deleted.body).toBe("");
		api.organizationIds.delete(createdBody.id);

		const absent = await api.server.inject({
			method: "GET",
			url: `/api/organizations/${createdBody.id}`,
			headers: { authorization },
		});
		expect(absent.statusCode).toBe(404);
	});

	it("enforces current-Organization isolation and platform precedence", async () => {
		const api = await useHarness();
		const actorId = await api.createOrganization("Current actor");
		const otherId = await api.createOrganization("Other Organization");
		const currentAuthorization = `Bearer ${api.token(actorId, "org_admin")}`;

		const currentList = await api.server.inject({
			method: "GET",
			url: "/api/organizations",
			headers: { authorization: currentAuthorization },
		});
		expect(currentList.json<Array<{ id: string }>>().map(item => item.id)).toEqual([actorId]);

		const denied = await api.server.inject({
			method: "GET",
			url: `/api/organizations/${otherId}`,
			headers: { authorization: currentAuthorization },
		});
		expect(denied.statusCode).toBe(403);

		const platformList = await api.server.inject({
			method: "GET",
			url: "/api/organizations?limit=100",
			headers: { authorization: `Bearer ${api.token(actorId, "super_admin")}` },
		});
		const ids = platformList.json<Array<{ id: string }>>().map(item => item.id);
		expect(ids).toContain(actorId);
		expect(ids).toContain(otherId);
	});

	it("enforces current-Organization mutation permissions on the assembled server", async () => {
		const api = await useHarness();
		const actorId = await api.createOrganization("Current mutation actor");
		const otherId = await api.createOrganization("Other mutation target");
		const authorization = `Bearer ${api.token(actorId, "org_admin")}`;

		const create = await api.server.inject({
			method: "POST",
			url: "/api/organizations",
			headers: { authorization },
			payload: { name: "Denied create" },
		});
		expect(create.statusCode).toBe(403);

		const updateOther = await api.server.inject({
			method: "PUT",
			url: `/api/organizations/${otherId}`,
			headers: { authorization },
			payload: { name: "Denied update" },
		});
		expect(updateOther.statusCode).toBe(403);

		const deleteOther = await api.server.inject({
			method: "DELETE",
			url: `/api/organizations/${otherId}`,
			headers: { authorization },
		});
		expect(deleteOther.statusCode).toBe(403);

		const updateSelf = await api.server.inject({
			method: "PUT",
			url: `/api/organizations/${actorId}`,
			headers: { authorization },
			payload: { name: "Updated current actor" },
		});
		expect(updateSelf.statusCode).toBe(200);
		expect(updateSelf.json()).toMatchObject({ id: actorId, name: "Updated current actor" });

		const deleteSelf = await api.server.inject({
			method: "DELETE",
			url: `/api/organizations/${actorId}`,
			headers: { authorization },
		});
		expect(deleteSelf.statusCode).toBe(204);
		api.organizationIds.delete(actorId);
	});

	it("keeps duplicate names valid and rejects distinct transport errors", async () => {
		const api = await useHarness();
		const actorId = await api.createOrganization("Platform actor");
		const authorization = `Bearer ${api.token(actorId)}`;

		for (const description of ["First", "Second"]) {
			const response = await api.server.inject({
				method: "POST",
				url: "/api/organizations",
				headers: { authorization },
				payload: { name: "Duplicate allowed", description },
			});
			expect(response.statusCode).toBe(201);
			api.rememberOrganization(response.json<{ id: string }>().id);
		}

		expect(
			(
				await api.server.inject({
					method: "GET",
					url: "/api/organizations?offset=-1",
					headers: { authorization },
				})
			).statusCode
		).toBe(400);
		expect(
			(
				await api.server.inject({
					method: "GET",
					url: "/api/organizations/not-an-id",
					headers: { authorization },
				})
			).statusCode
		).toBe(400);
		expect(
			(
				await api.server.inject({
					method: "GET",
					url: "/api/organizations",
					headers: { authorization: "Bearer invalid" },
				})
			).statusCode
		).toBe(401);
		const wrongSubjectAuthorization = `Bearer ${api.token(new TypeID("lgr").toString())}`;
		expect(
			(
				await api.server.inject({
					method: "GET",
					url: "/api/organizations",
					headers: { authorization: wrongSubjectAuthorization },
				})
			).statusCode
		).toBe(401);
	});

	it("maps a real dependent Ledger constraint to HTTP 409", async () => {
		const api = await useHarness();
		const actorId = await api.createOrganization("Platform actor");
		const targetId = await api.createOrganization("Dependent Organization");
		await api.createLedger(targetId);

		const response = await api.server.inject({
			method: "DELETE",
			url: `/api/organizations/${targetId}`,
			headers: { authorization: `Bearer ${api.token(actorId)}` },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json()).toMatchObject({
			type: "CONFLICT",
			organizationId: targetId,
		});
	});
});
