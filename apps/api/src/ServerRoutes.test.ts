import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
	TooManyRequestsError,
	UnauthorizedError,
} from "@/lib/errors";
import { Agent, createServer, type IncomingHttpHeaders, request } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Cause, Context, Effect, Exit, Layer, Logger, Scope } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { TypeID } from "typeid-js";
import { signJWT } from "@/auth";
import { IdempotencyPending } from "@/lib/IdempotencyService";
import type { OrgID } from "@/lib/ids";
import { OrganizationServiceTag, type OrganizationService } from "@/domains/organizations";
import { Organization } from "@/domains/organizations/Organization";
import { appLayer, makeTestWebHandler, type TestServiceLayers, testServicesLayer } from "@/server";

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>(r => {
		resolve = r;
	});
	return { promise, resolve };
};

/** Serves the HTTP app on a real socket (port 0) with the given services; closing `scope` drains it. */
const listen = async (overrides: TestServiceLayers = {}) => {
	const scope = Effect.runSync(Scope.make());
	const server = await Effect.runPromise(
		Effect.gen(function* () {
			const context = yield* Layer.buildWithScope(
				NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" }),
				scope
			);
			yield* Layer.buildWithScope(
				HttpRouter.serve(appLayer.pipe(Layer.provide(testServicesLayer(overrides))), {
					disableLogger: true,
				}).pipe(Layer.provide(Layer.succeedContext(context))),
				scope
			);
			return Context.get(context, HttpServer.HttpServer);
		})
	);
	const { port } = server.address as { port: number };
	return { port, scope, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
};

const sendRequest = (
	port: number,
	options: { method?: string; path: string; headers?: Record<string, string>; body?: string }
) =>
	new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
		const agent = new Agent({ keepAlive: true });
		const req = request(
			{
				host: "127.0.0.1",
				port,
				method: options.method ?? "GET",
				path: options.path,
				agent,
				headers: options.headers,
			},
			res => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", chunk => (body += chunk));
				res.on("end", () => {
					agent.destroy();
					resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
				});
			}
		);
		req.on("error", error => {
			agent.destroy();
			reject(error);
		});
		req.end(options.body);
	});

describe("Request lifecycle", () => {
	const organizationId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
	const authorization = () => ({
		authorization: `Bearer ${signJWT({ sub: organizationId.toString(), scope: ["super_admin"] })}`,
	});

	it.each([
		[
			"a success response",
			() => Effect.succeed(Organization.fromRequest(organizationId, { name: "Example" })),
			200,
		],
		["a rendered error response", () => Effect.die(new Error("boom")), 500],
	] as const)(
		"drains an in-flight request with %s and connection: close before releasing the services",
		async (_name, outcome, expectedStatus) => {
			const released = vi.fn<() => void>();
			const started = deferred();
			const finish = deferred();
			const service = {
				getOrganization: () =>
					Effect.gen(function* () {
						started.resolve();
						yield* Effect.promise(() => finish.promise);
						return yield* outcome();
					}),
			} as unknown as OrganizationService;
			const { port, close } = await listen({
				organization: Layer.effect(
					OrganizationServiceTag,
					Effect.gen(function* () {
						yield* Effect.addFinalizer(() => Effect.sync(released));
						return service;
					})
				),
			});
			try {
				const received = sendRequest(port, {
					path: `/api/organizations/${organizationId.toString()}`,
					headers: authorization(),
				}).catch((error: unknown) => error);
				await started.promise;
				const closing = close();
				await new Promise(resolve => setTimeout(resolve, 50));
				expect(released).not.toHaveBeenCalled();
				finish.resolve();
				const response = (await received) as { status: number; headers: IncomingHttpHeaders };
				expect({ status: response.status, connection: response.headers.connection }).toEqual({
					status: expectedStatus,
					connection: "close",
				});
				await closing;
				expect(released).toHaveBeenCalledOnce();
			} finally {
				finish.resolve();
				await close();
			}
		}
	);

	it("rejects a request body over 1 MiB with a problem response", async () => {
		const createOrganization = vi.fn(() => Effect.die(new Error("must not be reached")));
		const { port, close } = await listen({
			organization: Layer.succeed(OrganizationServiceTag, {
				createOrganization,
			} as unknown as OrganizationService),
		});
		try {
			const response = await sendRequest(port, {
				method: "POST",
				path: "/api/organizations",
				headers: { ...authorization(), "content-type": "application/json" },
				body: JSON.stringify({ name: "x".repeat(1_048_576 + 1024) }),
			});
			// An oversized body surfaces as a sanitised 500 problem, not 413, for parity with the pre-migration server.
			expect(response.status).toBe(500);
			expect(JSON.parse(response.body)).toMatchObject({
				type: "INTERNAL_SERVER_ERROR",
				status: 500,
				detail: "Internal Server Error",
			});
			expect(createOrganization).not.toHaveBeenCalled();
		} finally {
			await close();
		}
	});
});

describe("Effect HTTP edge", () => {
	const organizationId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
	const organization = Organization.fromRequest(organizationId, { name: "Example" });
	const logs: Array<{ level: string; text: string }> = [];
	const disposers: Array<() => Promise<void>> = [];

	const capture = Logger.layer([
		Logger.make(({ logLevel, message, cause }) => {
			logs.push({
				level: logLevel,
				text: `${JSON.stringify(message)} ${cause.reasons.length === 0 ? "" : Cause.pretty(cause)}`,
			});
		}),
	]);

	const stub = (overrides: Partial<Record<keyof OrganizationService, unknown>> = {}) =>
		({
			listOrganizations: vi.fn(() => Effect.succeed([organization])),
			getOrganization: vi.fn(() => Effect.succeed(organization)),
			createOrganization: vi.fn(() => Effect.succeed(organization)),
			updateOrganization: vi.fn(() => Effect.succeed(organization)),
			deleteOrganization: vi.fn(() => Effect.succeed(organization)),
			...overrides,
		}) as unknown as OrganizationService;

	const build = (service: OrganizationService = stub()) => {
		const { handler, dispose } = makeTestWebHandler({ organization: service }, capture);
		disposers.push(dispose);
		return handler;
	};

	const token = (scope: "super_admin" | "org_readonly" = "super_admin") =>
		signJWT({ sub: organizationId.toString(), scope: [scope] });
	const call = (
		method: string,
		path: string,
		options: { body?: string; contentType?: string; scope?: "super_admin" | "org_readonly" } = {}
	) =>
		new Request(`http://localhost${path}`, {
			method,
			headers: {
				authorization: `Bearer ${token(options.scope)}`,
				...(options.body === undefined
					? {}
					: { "content-type": options.contentType ?? "application/json" }),
			},
			body: options.body,
		});

	afterEach(async () => {
		logs.length = 0;
		for (const dispose of disposers.splice(0)) await dispose();
	});

	describe("request validation", () => {
		it("strips unknown body fields", async () => {
			const service = stub();
			const response = await build(service)(
				call("POST", "/api/organizations", { body: JSON.stringify({ name: "Example", extra: 1 }) })
			);
			expect(response.status).toBe(201);
			expect(service.createOrganization).toHaveBeenCalledWith({ name: "Example" });
		});

		it("rejects an out of range query with a BAD_REQUEST problem", async () => {
			const response = await build()(call("GET", "/api/organizations?limit=500"));
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
		});

		it("coerces query strings to integers", async () => {
			const service = stub();
			const response = await build(service)(call("GET", "/api/organizations?offset=5"));
			expect(response.status).toBe(200);
			expect(service.listOrganizations).toHaveBeenCalledWith({ offset: 5, limit: 20 });
		});

		it("rejects a wrongly typed body value", async () => {
			const response = await build()(
				call("POST", "/api/organizations", { body: JSON.stringify({ name: 123 }) })
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "BAD_REQUEST" });
		});

		it("returns 400 rather than 403 for an authenticated invalid body", async () => {
			const response = await build()(
				call("POST", "/api/organizations", {
					body: JSON.stringify({ name: 123 }),
					scope: "org_readonly",
				})
			);
			expect(response.status).toBe(400);
		});

		it("returns a BAD_REQUEST problem for malformed JSON", async () => {
			const response = await build()(call("POST", "/api/organizations", { body: "{not json" }));
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
		});

		it("returns 415 for an unsupported content type", async () => {
			const response = await build()(
				call("POST", "/api/organizations", { body: "name=x", contentType: "text/plain" })
			);
			expect(response.status).toBe(415);
		});
	});

	describe("failures at the edge", () => {
		it("renders a problem defect as its status", async () => {
			const service = stub({
				getOrganization: () => Effect.die(new BadRequestError("bad amount")),
			});
			const response = await build(service)(
				call("GET", `/api/organizations/${organizationId.toString()}`)
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				type: "BAD_REQUEST",
				detail: "bad amount",
			});
		});

		it("renders a 5xx problem defect as itself and logs its cause", async () => {
			const service = stub({
				getOrganization: () =>
					Effect.die(
						new ServiceUnavailableError("down", { retryable: true, cause: new Error("pool exhausted") })
					),
			});
			const response = await build(service)(
				call("GET", `/api/organizations/${organizationId.toString()}`)
			);
			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({
				type: "SERVICE_UNAVAILABLE",
				status: 503,
				detail: "down",
				retryable: true,
			});
			expect(
				logs.some(entry => entry.level === "Error" && entry.text.includes("pool exhausted"))
			).toBe(true);
		});

		it("never exposes the cause of a 5xx problem defect", async () => {
			const service = stub({
				getOrganization: () =>
					Effect.die(
						new ServiceUnavailableError("down", {
							retryable: true,
							retryAfterSeconds: 7,
							cause: new Error("pool exhausted"),
						})
					),
			});
			const response = await build(service)(
				call("GET", `/api/organizations/${organizationId.toString()}`)
			);
			const text = await response.text();
			expect(text).not.toContain("pool exhausted");
			expect(response.headers.get("retry-after")).toBe("7");
			expect(JSON.parse(text)).toMatchObject({ retryable: true });
		});

		const uuidV7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}";
		it.each([
			[BadRequestError, 400, "BAD_REQUEST", "Bad Request"],
			[UnauthorizedError, 401, "UNAUTHORIZED", "Unauthorized"],
			[ForbiddenError, 403, "FORBIDDEN", "Forbidden"],
			[NotFoundError, 404, "NOT_FOUND", "Not Found"],
			[ConflictError, 409, "CONFLICT", "Conflict"],
			[TooManyRequestsError, 429, "TOO_MANY_REQUESTS", "Too Many Requests"],
			[InternalServerError, 500, "INTERNAL_SERVER_ERROR", "Internal Server Error"],
			[ServiceUnavailableError, 503, "SERVICE_UNAVAILABLE", "Service Unavailable"],
		] as const)(
			"renders a %o defect as a complete problem body",
			async (ErrorClass, status, type, title) => {
				const service = stub({ getOrganization: () => Effect.die(new ErrorClass("x")) });
				const response = await build(service)(
					call("GET", `/api/organizations/${organizationId.toString()}`)
				);
				expect(response.status).toBe(status);
				const body = (await response.json()) as Record<string, unknown>;
				expect(body).toMatchObject({ type, status, title, detail: "x" });
				expect(body.instance).toMatch(new RegExp(`^/instance/${uuidV7}$`));
				expect(body.traceId).toMatch(new RegExp(`^${uuidV7}$`));
				expect(body).not.toHaveProperty("cause");
				expect(body).not.toHaveProperty("_tag");
			}
		);

		it("renders IdempotencyPending as a 409 with Retry-After", async () => {
			const service = stub({ deleteOrganization: () => Effect.fail(new IdempotencyPending()) });
			const response = await build(service)(
				call("DELETE", `/api/organizations/${organizationId.toString()}`)
			);
			expect(response.status).toBe(409);
			expect(response.headers.get("retry-after")).toBe("1");
			expect(await response.json()).toMatchObject({ type: "CONFLICT", retryable: true });
		});

		it("logs a request without credentials before returning 401", async () => {
			const response = await build()(new Request("http://localhost/api/organizations"));
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({ type: "UNAUTHORIZED", detail: "Invalid token" });
			expect(logs.some(entry => entry.level === "Error")).toBe(true);
		});

		it("sanitises and logs an unknown defect", async () => {
			const service = stub({
				getOrganization: () => Effect.die(new Error("database credentials")),
			});
			const response = await build(service)(
				call("GET", `/api/organizations/${organizationId.toString()}`)
			);
			const text = await response.text();
			expect(response.status).toBe(500);
			expect(JSON.parse(text)).toMatchObject({
				type: "INTERNAL_SERVER_ERROR",
				status: 500,
				detail: "Internal Server Error",
			});
			expect(text).not.toContain("database credentials");
			expect(logs.some(entry => entry.text.includes("database credentials"))).toBe(true);
		});

		it("logs a declared 5xx error together with its cause", async () => {
			const service = stub({
				getOrganization: () =>
					Effect.fail(new ServiceUnavailableError("down", { cause: new Error("pool exhausted") })),
			});
			const response = await build(service)(
				call("GET", `/api/organizations/${organizationId.toString()}`)
			);
			expect(response.status).toBe(503);
			expect(logs.some(entry => entry.text.includes("pool exhausted"))).toBe(true);
		});

		it("renders an undeclared failure as a sanitised, logged 500", async () => {
			const service = stub({
				getOrganization: () => Effect.fail(new Error("undeclared secret")),
			});
			const response = await build(service)(
				call("GET", `/api/organizations/${organizationId.toString()}`)
			);
			const text = await response.text();
			expect(response.status).toBe(500);
			expect(JSON.parse(text)).toMatchObject({ type: "INTERNAL_SERVER_ERROR" });
			expect(text).not.toContain("undeclared secret");
			expect(logs.some(entry => entry.text.includes("undeclared secret"))).toBe(true);
		});

		it("renders a response violating the success schema as a logged 500 problem", async () => {
			const service = stub({
				getOrganization: () => Effect.succeed({ toResponse: () => ({ id: 1 }) }),
			});
			const response = await build(service)(
				call("GET", `/api/organizations/${organizationId.toString()}`)
			);
			expect(response.status).toBe(500);
			expect(await response.json()).toMatchObject({ type: "INTERNAL_SERVER_ERROR", status: 500 });
			expect(logs.some(entry => entry.level === "Error")).toBe(true);
		});

		it("renders an unknown route as a NOT_FOUND problem", async () => {
			const response = await build()(call("GET", "/api/nope"));
			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({ type: "NOT_FOUND", status: 404 });
		});
	});

	describe("health and docs", () => {
		it("serves /health without auth", async () => {
			const response = await build()(new Request("http://localhost/health"));
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({});
		});

		it("serves the docs UI", async () => {
			const response = await build()(new Request("http://localhost/docs"));
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
		});

		it("serves the OpenAPI document", async () => {
			const response = await build()(new Request("http://localhost/docs/json"));
			expect(response.status).toBe(200);
			const document = (await response.json()) as {
				info: { title: string; version: string };
				servers: Array<{ url: string }>;
				tags: Array<{ name: string }>;
				components: { securitySchemes: Record<string, { type: string; scheme?: string }> };
			};
			expect(document.info).toMatchObject({ title: "Ledger API", version: "0.1.0" });
			expect(document.servers).toEqual([
				{ url: "http://localhost:3000", description: "Development server" },
			]);
			// Tags come from each group's title; the Ledgers tag arrives with its group.
			expect(document.tags).toContainEqual({
				name: "Organizations",
				description: "An organization is a tenant on the platform.",
			});
			expect(
				Object.values(document.components.securitySchemes).map(scheme => [
					scheme.type,
					scheme.scheme?.toLowerCase(),
				])
			).toContainEqual(["http", "bearer"]);
		});
	});
});
