import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiTestHarness } from "../testing/ApiTestHarness";
import { createApiTestHarness, runCleanupSteps } from "../testing/ApiTestHarness";

const harnesses: ApiTestHarness[] = [];

afterEach(async () => {
	await runCleanupSteps(
		harnesses
			.splice(0)
			.reverse()
			.map(harness => harness.close)
	);
});

describe.sequential("Organization distributed rate limiting", () => {
	it("shares an actor bucket across servers and isolates another actor", async () => {
		const environment = `rate-limit-${new TypeID("tst").toString()}`;
		const first = await createApiTestHarness({ environment, rateLimitMax: 2 });
		const second = await createApiTestHarness({ environment, rateLimitMax: 2 });
		harnesses.push(first, second);
		const actorId = await first.createOrganization("Rate-limit actor");
		const otherId = await first.createOrganization("Independent actor");
		const authorization = `Bearer ${first.token(actorId, "org_admin")}`;

		const firstResponse = await first.server.inject({
			method: "GET",
			url: "/api/organizations",
			headers: { authorization },
		});
		const secondResponse = await second.server.inject({
			method: "GET",
			url: "/api/organizations",
			headers: { authorization },
		});
		const exceeded = await first.server.inject({
			method: "GET",
			url: "/api/organizations",
			headers: { authorization },
		});

		expect(firstResponse.statusCode).toBe(200);
		expect(firstResponse.headers["x-ratelimit-limit"]).toBe("2");
		expect(secondResponse.statusCode).toBe(200);
		expect(exceeded.statusCode).toBe(429);
		expect(exceeded.headers["retry-after"]).toBeDefined();
		expect(exceeded.json()).toMatchObject({ type: "TOO_MANY_REQUESTS", status: 429 });

		const independent = await second.server.inject({
			method: "GET",
			url: "/api/organizations",
			headers: { authorization: `Bearer ${second.token(otherId, "org_admin")}` },
		});
		expect(independent.statusCode).toBe(200);
	});

	it("does not consume a valid actor bucket for invalid authentication", async () => {
		const api = await createApiTestHarness({ rateLimitMax: 1 });
		harnesses.push(api);
		const actorId = await api.createOrganization("Authenticated actor");

		const invalid = await api.server.inject({
			method: "GET",
			url: "/api/organizations",
			headers: { authorization: "Bearer invalid" },
		});
		const valid = await api.server.inject({
			method: "GET",
			url: "/api/organizations",
			headers: { authorization: `Bearer ${api.token(actorId, "org_admin")}` },
		});

		expect(invalid.statusCode).toBe(401);
		expect(valid.statusCode).toBe(200);
	});
});
