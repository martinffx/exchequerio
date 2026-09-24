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
} from "@/lib/errors";
import { EventEmitter } from "node:events";
import { request } from "node:http";
import { Effect, Layer } from "effect";
import { Config } from "@/config";
import { ServerConfigTag, type ServerRuntimeLayer } from "@/runtime";
import { buildServer } from "@/server";
import { registerShutdown } from "@/shutdown";

const servers: FastifyInstance[] = [];

const buildErrorServer = async (failure: Error = new NotFoundError("Organization not found")) => {
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
		throw failure;
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
	] as const)("maps %s", async (error, status, type, title) => {
		const server = await buildErrorServer(error);
		const response = await server.inject({ method: "GET", url: "/typed" });
		expect(response.statusCode).toBe(status);
		expect(response.json()).toMatchObject({ status, type, title, detail: error.message });
	});

	it("serializes retryability without exposing the cause", async () => {
		const cause = new Error("database credentials");
		const server = await buildErrorServer(
			new ConflictError("Organization conflict", {
				cause,
				retryable: true,
			})
		);
		const problem = (await server.inject({ method: "GET", url: "/typed" })).json<{
			instance: string;
			traceId: string;
		}>();

		expect(problem).toMatchObject({ retryable: true });
		expect(problem.instance).toMatch(/^\/instance\/[0-9a-f-]{36}$/);
		expect(problem.traceId).toMatch(/^[0-9a-f-]{36}$/);
		expect(problem).not.toHaveProperty("cause");
	});
});

describe("globalErrorHandler", () => {
	it("maps Fastify validation errors", async () => {
		const server = await buildErrorServer();
		const response = await server.inject({ method: "POST", url: "/validation", payload: {} });

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
	});

	it("maps typed errors", async () => {
		const server = await buildErrorServer();
		const response = await server.inject({ method: "GET", url: "/typed" });

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({ type: "NOT_FOUND", status: 404 });
	});

	it("maps under-pressure errors as retryable", async () => {
		const server = await buildErrorServer();
		const response = await server.inject({ method: "GET", url: "/pressure" });

		expect(response.statusCode).toBe(503);
		expect(response.json()).toMatchObject({
			type: "SERVICE_UNAVAILABLE",
			status: 503,
			retryable: true,
		});
	});

	it("logs and sanitizes unknown errors", async () => {
		const server = await buildErrorServer();
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

describe("Request lifecycle", () => {
	describe("API shutdown", () => {
		it.each(["SIGTERM", "SIGINT"])(
			"drains an active request on %s before releasing runtime resources",
			async signal => {
				const disposed = vi.fn<() => void>();
				const runtimeLayer = Layer.effect(
					ServerConfigTag,
					Effect.gen(function* () {
						yield* Effect.addFinalizer(() => Effect.sync(disposed));
						return new Config({ environment: "test", jwtSecret: "test-secret" });
					})
				) as ServerRuntimeLayer;
				const server = await buildServer({ runtimeLayer });
				const signals = new EventEmitter();
				const stop = registerShutdown(server, signals);
				let beginRequest!: () => void;
				const started = new Promise<void>(resolve => {
					beginRequest = resolve;
				});
				let finishEnqueue!: () => void;
				const enqueue = new Promise<void>(resolve => {
					finishEnqueue = resolve;
				});
				server.get("/drain-test", async () => {
					beginRequest();
					await enqueue;
					return { committed: true };
				});
				const address = await server.listen({ port: 0, host: "127.0.0.1" });
				const response = new Promise<string>((resolve, reject) => {
					const req = request(`${address}/drain-test`, res => {
						let body = "";
						res.on("data", chunk => {
							body += chunk;
						});
						res.on("end", () => resolve(body));
					});
					req.on("error", reject);
					req.end();
				});
				// Attach rejection handling before signalling shutdown.
				const received = response.catch((error: unknown) => error);
				try {
					await started;
					signals.emit(signal);
					const closing = stop();
					expect(stop()).toBe(closing);
					await new Promise(resolve => setTimeout(resolve, 25));
					expect(disposed).not.toHaveBeenCalled();
					finishEnqueue();
					expect(await received).toBe('{"committed":true}');
					await closing;
					expect(disposed).toHaveBeenCalledOnce();
					expect(signals.listenerCount("SIGTERM")).toBe(0);
					expect(signals.listenerCount("SIGINT")).toBe(0);
				} finally {
					finishEnqueue();
					await server.close();
				}
			}
		);
	});
});
