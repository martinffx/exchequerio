import { describe, expect, it } from "vitest";
import {
	InvalidId,
	OrganizationHasDependents,
	OrganizationNotFound,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "../organizations/domain/OrganizationErrors";
import { httpFailure } from "./HttpErrors";
import { ForbiddenError, HttpError } from "./ProblemDetails";

const context = {
	instance: "/api/organizations/org_123",
	traceId: "trace-id",
};

describe("httpFailure", () => {
	it.each([
		[new InvalidId("org", "invalid"), 400, "BAD_REQUEST"],
		[new ForbiddenError("Forbidden"), 403, "FORBIDDEN"],
		[new OrganizationNotFound("org_123"), 404, "NOT_FOUND"],
		[new OrganizationHasDependents("org_123"), 409, "CONFLICT"],
		[
			new OrganizationPersistenceDecodingFailure(new Error("invalid row")),
			500,
			"INTERNAL_SERVER_ERROR",
		],
		[new OrganizationPersistenceFailure(new Error("query failed")), 500, "INTERNAL_SERVER_ERROR"],
		[new OrganizationRepositoryUnavailable(new Error("unavailable")), 503, "SERVICE_UNAVAILABLE"],
	] as const)("maps %s", (error, status, type) => {
		expect(error).toBeInstanceOf(HttpError);
		expect(httpFailure(error, context)).toMatchObject({
			status,
			problem: { ...context, status, type },
		});
	});

	it("preserves typed extensions without exposing the cause", () => {
		const cause = new Error("database credentials");
		const failure = httpFailure(new OrganizationRepositoryUnavailable(cause), context);

		expect(failure.cause).toBe(cause);
		expect(failure.problem).toMatchObject({ retryable: true });
		expect(failure.problem).not.toHaveProperty("cause");
	});

	it("preserves an Organization identifier", () => {
		const failure = httpFailure(new OrganizationNotFound("org_123"), context);

		expect(failure.problem).toMatchObject({ organizationId: "org_123" });
	});
});
