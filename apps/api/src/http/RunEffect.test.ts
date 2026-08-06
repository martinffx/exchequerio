import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { OrganizationAccessDenied, OrganizationPersistenceFailure } from "../organizations";
import { runEffect } from "./RunEffect";

const request = () => ({
	id: "request-1",
	url: "/api/organizations",
	log: { error: vi.fn() },
});

describe("runEffect", () => {
	it("returns successful values", async () => {
		const rq = request();

		expect(await runEffect(rq, Effect.succeed("ok"))).toEqual({ _tag: "Success", value: "ok" });
		expect(rq.log.error).not.toHaveBeenCalled();
	});

	it("maps expected tagged errors with request context", async () => {
		const rq = request();

		const result = await runEffect(rq, Effect.fail(new OrganizationAccessDenied("org_target")));
		expect(result._tag).toBe("Failure");
		if (result._tag === "Success") throw new Error("expected failure");
		expect(result.status).toBe(403);
		expect(result.problem).toMatchObject({
			type: "FORBIDDEN",
			status: 403,
			instance: "/api/organizations",
			traceId: "request-1",
			organizationId: "org_target",
		});
	});

	it("sanitizes and logs persistence failures", async () => {
		const rq = request();
		const cause = new Error("secret database detail");

		const result = await runEffect(rq, Effect.fail(new OrganizationPersistenceFailure(cause)));

		expect(result._tag).toBe("Failure");
		if (result._tag === "Success") throw new Error("expected failure");
		expect(result.status).toBe(500);
		expect(result.problem).toMatchObject({
			type: "INTERNAL_SERVER_ERROR",
			detail: "The Organization operation could not be completed",
		});
		expect(JSON.stringify(result)).not.toContain("secret database detail");
		expect(rq.log.error).toHaveBeenCalledOnce();
	});

	it("sanitizes and logs unexpected defects", async () => {
		const rq = request();

		const result = await runEffect(rq, Effect.die(new Error("secret defect")));

		expect(result._tag).toBe("Failure");
		if (result._tag === "Success") throw new Error("expected failure");
		expect(result.status).toBe(500);
		expect(result.problem).toMatchObject({ type: "INTERNAL_SERVER_ERROR", status: 500 });
		expect(rq.log.error).toHaveBeenCalledOnce();
	});
});
