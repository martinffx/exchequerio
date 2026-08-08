import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	globalErrorHandler,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
	TooManyRequestsError,
	UnauthorizedError,
} from "./errors";

const servers: FastifyInstance[] = [];

const buildServer = async () => {
	const server = fastify();
	server.setErrorHandler(globalErrorHandler);
	server.post(
		"/validation",
		{
			schema: {
				body: {
					type: "object",
					required: ["name"],
					properties: { name: { type: "string" } },
					additionalProperties: false,
				},
			},
		},
		async () => ({})
	);
	server.get("/typed", async () => {
		throw new NotFoundError("Organization not found", { organizationId: "org_123" });
	});
	server.get("/pressure", async () => {
		throw Object.assign(new Error("Server under pressure"), { code: "FST_UNDER_PRESSURE" });
	});
	server.get("/unknown", async () => {
		throw new Error("database credentials");
	});
	await server.ready();
	servers.push(server);
	return server;
};

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
});

describe("HttpError", () => {
	it.each([
		[new BadRequestError("bad request"), 400, "BAD_REQUEST", "Bad Request"],
		[new UnauthorizedError("unauthorized"), 401, "UNAUTHORIZED", "Unauthorized"],
		[new ForbiddenError("forbidden"), 403, "FORBIDDEN", "Forbidden"],
		[new NotFoundError("not found"), 404, "NOT_FOUND", "Not Found"],
		[new ConflictError("conflict"), 409, "CONFLICT", "Conflict"],
		[new TooManyRequestsError("rate limited"), 429, "TOO_MANY_REQUESTS", "Too Many Requests"],
		[
			new InternalServerError("internal error"),
			500,
			"INTERNAL_SERVER_ERROR",
			"Internal Server Error",
		],
		[new ServiceUnavailableError("unavailable"), 503, "SERVICE_UNAVAILABLE", "Service Unavailable"],
	] as const)("maps %s", (error, status, type, title) => {
		expect(error.toProblemDetail()).toMatchObject({ status, type, title, detail: error.message });
	});

	it("serializes context without exposing the cause", () => {
		const cause = new Error("database credentials");
		const problem = new ConflictError("Organization conflict", {
			cause,
			organizationId: "org_123",
			ledgerId: "lgr_123",
			retryable: true,
		}).toProblemDetail();

		expect(problem).toMatchObject({
			organizationId: "org_123",
			ledgerId: "lgr_123",
			retryable: true,
		});
		expect(problem.instance).toMatch(/^\/instance\/[0-9a-f-]{36}$/);
		expect(problem.traceId).toMatch(/^[0-9a-f-]{36}$/);
		expect(problem).not.toHaveProperty("cause");
	});
});

describe("globalErrorHandler", () => {
	it("maps Fastify validation errors", async () => {
		const server = await buildServer();
		const response = await server.inject({ method: "POST", url: "/validation", payload: {} });

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
	});

	it("maps typed errors with their context", async () => {
		const server = await buildServer();
		const response = await server.inject({ method: "GET", url: "/typed" });

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			type: "NOT_FOUND",
			status: 404,
			organizationId: "org_123",
		});
	});

	it("maps under-pressure errors as retryable", async () => {
		const server = await buildServer();
		const response = await server.inject({ method: "GET", url: "/pressure" });

		expect(response.statusCode).toBe(503);
		expect(response.json()).toMatchObject({
			type: "SERVICE_UNAVAILABLE",
			status: 503,
			retryable: true,
		});
	});

	it("logs and sanitizes unknown errors", async () => {
		const server = await buildServer();
		const logError = vi.spyOn(server.log, "error");
		const response = await server.inject({ method: "GET", url: "/unknown" });

		expect(response.statusCode).toBe(500);
		expect(response.json()).toMatchObject({
			type: "INTERNAL_SERVER_ERROR",
			status: 500,
			detail: "Internal Server Error",
		});
		expect(response.body).not.toContain("database credentials");
		expect(logError).toHaveBeenCalled();
	});
});
