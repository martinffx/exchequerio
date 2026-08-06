import { describe, expect, it, vi } from "vitest";
import { applyOrganizationRateLimit } from "./OrganizationRateLimit";

const reply = () => ({ header: vi.fn() });

describe("applyOrganizationRateLimit", () => {
	it("adds quota headers for an allowed request", async () => {
		const rs = reply();
		const result = await applyOrganizationRateLimit(
			vi.fn().mockResolvedValue({
				isAllowed: false,
				isExceeded: false,
				isBanned: false,
				key: "org_actor",
				max: 10,
				remaining: 9,
				timeWindow: 60_000,
				ttl: 45_000,
				ttlInSeconds: 45,
			}),
			{} as never,
			rs
		);

		expect(result).toEqual({ _tag: "Allowed" });
		expect(rs.header).toHaveBeenCalledWith("x-ratelimit-limit", 10);
		expect(rs.header).toHaveBeenCalledWith("x-ratelimit-remaining", 9);
		expect(rs.header).toHaveBeenCalledWith("x-ratelimit-reset", 45);
	});

	it("returns an RFC 7807 failure and Retry-After when exceeded", async () => {
		const rs = reply();
		const result = await applyOrganizationRateLimit(
			vi.fn().mockResolvedValue({
				isAllowed: false,
				isExceeded: true,
				isBanned: false,
				key: "org_actor",
				max: 10,
				remaining: 0,
				timeWindow: 60_000,
				ttl: 45_000,
				ttlInSeconds: 45,
			}),
			{ id: "request-1", url: "/api/organizations" } as never,
			rs
		);

		expect(result._tag).toBe("Failure");
		if (result._tag === "Allowed") throw new Error("expected failure");
		expect(result.status).toBe(429);
		expect(result.problem).toMatchObject({
			type: "TOO_MANY_REQUESTS",
			instance: "/api/organizations",
			traceId: "request-1",
		});
		expect(rs.header).toHaveBeenCalledWith("retry-after", 45);
	});

	it("fails closed when the store rejects", async () => {
		const rs = reply();
		const result = await applyOrganizationRateLimit(
			vi.fn().mockRejectedValue(new Error("redis secret")),
			{ id: "request-1", url: "/api/organizations" } as never,
			rs
		);

		expect(result._tag).toBe("Failure");
		if (result._tag === "Allowed") throw new Error("expected failure");
		expect(result.status).toBe(503);
		expect(result.problem).toMatchObject({
			type: "SERVICE_UNAVAILABLE",
			detail: "The Organization rate-limit store is unavailable",
		});
		expect(JSON.stringify(result)).not.toContain("redis secret");
	});
});
