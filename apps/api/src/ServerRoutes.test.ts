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
import { Agent, type IncomingHttpHeaders, request } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Logger, References, Scope, Tracer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { TypeID } from "typeid-js";
import { signJWT } from "@/auth";
import type { OrgID } from "@/lib/ids";
import type { OrganizationService } from "@/domains/organizations";
import { Organization } from "@/domains/organizations/Organization";
import {
	makeRequest,
	type TestStubs,
	testServicesLayer,
	tokenFor,
	useTestWebHandlers,
} from "@/lib/testing";
import { appLayer, createHttpServer, serveApp } from "@/server";

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>(r => {
		resolve = r;
	});
	return { promise, resolve };
};

/** A sampled W3C `traceparent` header for a trace id. */
const traceparent = (traceId: string) => ({ traceparent: `00-${traceId}-b7ad6b7169203331-01` });

/** Polls (up to ~1 s) until the condition holds. */
const until = async (condition: () => boolean) => {
	for (let i = 0; i < 200 && !condition(); i++) await new Promise(r => setTimeout(r, 5));
};

/**
 * Serves the HTTP app on a real socket (port 0) through the production `createHttpServer` and
 * `serveApp` composition; closing `scope` drains it, releases the services (and `servicesExtra`),
 * then logs shutdown completion.
 */
const listen = async (
	stubs: TestStubs = {},
	extra: Layer.Layer<never> = Layer.empty,
	servicesExtra: Layer.Layer<never> = Layer.empty
) => {
	const scope = Effect.runSync(Scope.make());
	let port = 0;
	const server = Layer.effectDiscard(
		Effect.gen(function* () {
			port = ((yield* HttpServer.HttpServer).address as { port: number }).port;
		})
	).pipe(Layer.provideMerge(NodeHttpServer.layer(createHttpServer, { port: 0, host: "127.0.0.1" })));
	await Effect.runPromise(
		Layer.buildWithScope(
			serveApp(server, testServicesLayer(stubs, servicesExtra)).pipe(Layer.provide(extra)),
			scope
		)
	);
	return {
		port,
		scope,
		close: () => Effect.runPromise(Scope.close(scope, Exit.void).pipe(Effect.provide(extra))),
	};
};

const sendRequest = (
	port: number,
	options: {
		method?: string;
		path: string;
		headers?: Record<string, string>;
		body?: string;
		/** Written as separate chunks, so no `content-length` is sent (set `transfer-encoding: chunked`). */
		chunks?: ReadonlyArray<string>;
	}
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
		for (const chunk of options.chunks ?? []) req.write(chunk);
		req.end(options.body);
	});

type OpenApiPaths = { paths: Record<string, Record<string, unknown>> };
const httpMethods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

const operationKeys = (document: OpenApiPaths) =>
	Object.entries(document.paths).flatMap(([path, item]) =>
		Object.keys(item)
			.filter(method => httpMethods.has(method))
			.map(method => ({ key: `${method.toUpperCase()} ${path}`, operation: item[method] }))
	);

const operationsWithoutBearer = (document: OpenApiPaths) =>
	operationKeys(document)
		.filter(
			({ operation }) =>
				JSON.stringify((operation as { security?: unknown }).security) !==
				JSON.stringify([{ bearer: [] }])
		)
		.map(({ key }) => key);

describe("HTTP server options", () => {
	it("keeps the pre-migration timeouts, including Node's 60 s header deadline", () => {
		const server = createHttpServer();
		expect({
			keepAliveTimeout: server.keepAliveTimeout,
			requestTimeout: server.requestTimeout,
			headersTimeout: server.headersTimeout,
		}).toEqual({ keepAliveTimeout: 72_000, requestTimeout: 0, headersTimeout: 60_000 });
		server.close();
	});
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
			const events: Array<string> = [];
			const eventLogger = Logger.layer([
				Logger.make(({ message }) => {
					const text = JSON.stringify(message);
					if (text.includes("API shutdown")) events.push(text);
				}),
			]);
			const released = vi.fn<() => void>(() => {
				events.push("services released");
			});
			const started = deferred();
			const finish = deferred();
			const service = {
				getOrganization: () =>
					Effect.gen(function* () {
						started.resolve();
						yield* Effect.promise(() => finish.promise);
						events.push("handler finished");
						return yield* outcome();
					}),
			} as unknown as OrganizationService;
			const { port, close } = await listen(
				{ organization: service },
				eventLogger,
				Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(released)))
			);
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
				expect(events).toEqual([
					'["API shutdown started"]',
					"handler finished",
					"services released",
					'["API shutdown complete"]',
				]);
			} finally {
				finish.resolve();
				await close();
			}
		}
	);

	it("rejects a request body over 1 MiB with a problem response", async () => {
		const createOrganization = vi.fn(() => Effect.die(new Error("must not be reached")));
		const { port, close } = await listen({
			organization: { createOrganization } as unknown as OrganizationService,
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
			// The socket is closed so Node does not read and discard the rest of the declared body.
			expect(response.headers.connection).toBe("close");
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

	it("never reaches the handler with a chunked body over 1 MiB", async () => {
		const createOrganization = vi.fn(() => Effect.die(new Error("must not be reached")));
		const { port, close } = await listen({
			organization: { createOrganization } as unknown as OrganizationService,
		});
		try {
			// No content-length is sent, so only the MaxBodySize layer bounds the read.
			const outcome = await sendRequest(port, {
				method: "POST",
				path: "/api/organizations",
				headers: {
					...authorization(),
					"content-type": "application/json",
					"transfer-encoding": "chunked",
				},
				chunks: ['{"name":"', "x".repeat(600_000), "x".repeat(600_000), '"}'],
			}).then(
				response => response.status,
				() => "connection closed" as const
			);
			expect(outcome).toBe("connection closed");
			expect(createOrganization).not.toHaveBeenCalled();
		} finally {
			await close();
		}
	});
});

describe("Effect HTTP edge", () => {
	const organizationId = TypeID.fromString<"org">("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
	const organization = Organization.fromRequest(organizationId, { name: "Example" });
	const logs: Array<{ level: string; text: string; annotations: Record<string, unknown> }> = [];

	const capture = Logger.layer([
		Logger.make(({ logLevel, message, cause, fiber }) => {
			logs.push({
				annotations: fiber.getRef(References.CurrentLogAnnotations),
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

	const handlerFor = useTestWebHandlers();
	const build = (service: OrganizationService = stub()) =>
		handlerFor({ organization: service }, capture);

	const tokenAs = tokenFor(organizationId);
	const token = () => tokenAs(["super_admin"]);
	const request = makeRequest(token);
	const call = request;

	afterEach(() => {
		logs.length = 0;
	});

	describe("request validation", () => {
		it("strips unknown body fields", async () => {
			const service = stub();
			const response = await build(service)(
				call("POST", "/api/organizations", { body: { name: "Example", extra: 1 } })
			);
			expect(response.status).toBe(201);
			expect(service.createOrganization).toHaveBeenCalledWith({ name: "Example" });
		});

		it("rejects an out of range query with a BAD_REQUEST problem", async () => {
			const response = await build()(call("GET", "/api/organizations?limit=500"));
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
		});

		it("rejects a wrongly typed body value", async () => {
			const response = await build()(call("POST", "/api/organizations", { body: { name: 123 } }));
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "BAD_REQUEST" });
		});

		it("returns 400 rather than 403 for an authenticated invalid body", async () => {
			const response = await build()(
				call("POST", "/api/organizations", {
					body: { name: 123 },
					token: tokenAs(["org_readonly"]),
				})
			);
			expect(response.status).toBe(400);
		});

		it("returns a BAD_REQUEST problem for malformed JSON", async () => {
			const response = await build()(
				call("POST", "/api/organizations", {
					rawBody: "{not json",
					headers: { "content-type": "application/json" },
				})
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
		});

		it("returns 415 for an unsupported content type", async () => {
			const response = await build()(
				call("POST", "/api/organizations", {
					rawBody: "name=x",
					headers: { "content-type": "text/plain" },
				})
			);
			expect(response.status).toBe(415);
		});

		it("decodes a payload sent without a content type as JSON", async () => {
			const service = stub();
			const response = await build(service)(
				new Request("http://localhost/api/organizations", {
					method: "POST",
					headers: { authorization: `Bearer ${token()}` },
					// A byte body gets no content-type header from the Request constructor.
					body: new TextEncoder().encode(JSON.stringify({ name: "Example" })),
				})
			);
			expect(response.status).toBe(201);
			expect(service.createOrganization).toHaveBeenCalledWith({ name: "Example" });
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
		const traceId = "0af7651916cd43dd8448eb211c80319c";
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
					call("GET", `/api/organizations/${organizationId.toString()}`, {
						headers: traceparent(traceId),
					})
				);
				expect(response.status).toBe(status);
				const body = (await response.json()) as Record<string, unknown>;
				expect(body).toMatchObject({ type, status, title, detail: "x" });
				expect(body.instance).toMatch(new RegExp(`^/instance/${uuidV7}$`));
				expect(body.traceId).toBe(traceId);
				expect(body).not.toHaveProperty("cause");
				expect(body).not.toHaveProperty("_tag");
			}
		);

		it("carries the request trace id on a declared error", async () => {
			const service = stub({ getOrganization: () => Effect.fail(new NotFoundError("gone")) });
			const response = await build(service)(
				call("GET", `/api/organizations/${organizationId.toString()}`, {
					headers: traceparent(traceId),
				})
			);
			expect(response.status).toBe(404);
			expect(((await response.json()) as { traceId: string }).traceId).toBe(traceId);
		});

		it("mints a fresh instance and traceId for every problem", async () => {
			const service = stub({ getOrganization: () => Effect.fail(new NotFoundError("gone")) });
			const handler = build(service);
			const path = `/api/organizations/${organizationId.toString()}`;
			const first = (await (await handler(call("GET", path))).json()) as Record<string, unknown>;
			const second = (await (await handler(call("GET", path))).json()) as Record<string, unknown>;
			expect(first.instance).not.toBe(second.instance);
			expect(first.traceId).not.toBe(second.traceId);
		});

		it("encodes a declared error with retryable and retry-after only when set", async () => {
			const path = `/api/organizations/${organizationId.toString()}`;
			const plain = await build(
				stub({ deleteOrganization: () => Effect.fail(new ConflictError("busy")) })
			)(call("DELETE", path));
			expect(plain.status).toBe(409);
			expect(plain.headers.has("retry-after")).toBe(false);
			expect(await plain.json()).not.toHaveProperty("retryable");

			const set = await build(
				stub({
					deleteOrganization: () =>
						Effect.fail(new ConflictError("busy", { retryable: true, retryAfterSeconds: 3 })),
				})
			)(call("DELETE", path));
			expect(set.status).toBe(409);
			expect(set.headers.get("retry-after")).toBe("3");
			const body = await set.json();
			expect(body).toMatchObject({ retryable: true });
			expect(body).not.toHaveProperty("retryAfterSeconds");
		});

		it("makes a declared ServiceUnavailable retryable by default", async () => {
			const service = stub({
				getOrganization: () => Effect.fail(new ServiceUnavailableError("down")),
			});
			const response = await build(service)(
				call("GET", `/api/organizations/${organizationId.toString()}`)
			);
			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({ type: "SERVICE_UNAVAILABLE", retryable: true });
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
			expect(await response.text()).not.toContain("pool exhausted");
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

		it("carries the request trace id on an unknown-route problem", async () => {
			const id = "4bf92f3577b34da6a3ce929d0e0e4736";
			const response = await build()(call("GET", "/api/nope", { headers: traceparent(id) }));
			expect(response.status).toBe(404);
			expect(((await response.json()) as { traceId: string }).traceId).toBe(id);
		});

		it("ends the server span in Error status when a 5xx is rendered", async () => {
			const spans: Tracer.NativeSpan[] = [];
			const tracer = Tracer.make({
				span: options => {
					const span = new Tracer.NativeSpan(options);
					spans.push(span);
					return span;
				},
			});
			const service = stub({
				getOrganization: () => Effect.succeed({ toResponse: () => ({ id: 1 }) }),
			});
			const response = await handlerFor(
				{ organization: service },
				Layer.mergeAll(capture, Layer.succeed(Tracer.Tracer, tracer))
			)(call("GET", `/api/organizations/${organizationId.toString()}`));
			expect(response.status).toBe(500);
			expect(await response.json()).toMatchObject({ type: "INTERNAL_SERVER_ERROR" });
			const server = () => spans.find(span => span.name.startsWith("http.server"));
			await until(() => server()?.status._tag === "Ended");
			const status = server()?.status;
			expect(status?._tag === "Ended" && status.exit._tag).toBe("Failure");
		});

		it("leaves the server span successful for a 4xx", async () => {
			const spans: Tracer.NativeSpan[] = [];
			const tracer = Tracer.make({
				span: options => {
					const span = new Tracer.NativeSpan(options);
					spans.push(span);
					return span;
				},
			});
			const response = await handlerFor(
				{ organization: stub() },
				Layer.mergeAll(capture, Layer.succeed(Tracer.Tracer, tracer))
			)(call("GET", "/api/nope"));
			expect(response.status).toBe(404);
			const server = () => spans.find(span => span.name.startsWith("http.server"));
			await until(() => server()?.status._tag === "Ended");
			const status = server()?.status;
			expect(status?._tag === "Ended" && status.exit._tag).toBe("Success");
		});

		it("renders an unknown route as a NOT_FOUND problem", async () => {
			const response = await build()(call("GET", "/api/nope"));
			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({ type: "NOT_FOUND", status: 404 });
		});
	});

	describe("client disconnect", () => {
		it("lets a write run to completion after the client aborts", async () => {
			const gate = deferred();
			let started = false;
			let completed = false;
			const createOrganization = vi.fn(() =>
				Effect.gen(function* () {
					started = true;
					yield* Effect.promise(() => gate.promise);
					completed = true; // models the post-commit publish and idempotency complete
					return organization;
				})
			);
			const controller = new AbortController();
			const pending = build(stub({ createOrganization }))(
				new Request("http://localhost/api/organizations", {
					method: "POST",
					headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
					body: JSON.stringify({ name: "Example" }),
					signal: controller.signal,
				})
			).catch(() => undefined);
			await until(() => started);
			expect(started).toBe(true);
			controller.abort();
			await new Promise(r => setTimeout(r, 50));
			gate.resolve();
			await until(() => completed);
			await pending;
			expect(completed).toBe(true);
		});

		it("lets a read run to completion after the client aborts", async () => {
			const gate = deferred();
			let started = false;
			let interrupted = false;
			let completed = false;
			const getOrganization = vi.fn(() =>
				Effect.gen(function* () {
					started = true;
					yield* Effect.promise(() => gate.promise);
					completed = true; // an interrupted read would leave its query to a late pg_cancel_backend
					return organization;
				}).pipe(Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true))))
			);
			const controller = new AbortController();
			const pending = build(stub({ getOrganization }))(
				new Request(`http://localhost/api/organizations/${organizationId.toString()}`, {
					headers: { authorization: `Bearer ${token()}` },
					signal: controller.signal,
				})
			).catch(() => undefined);
			await until(() => started);
			expect(started).toBe(true);
			controller.abort();
			await new Promise(r => setTimeout(r, 50));
			gate.resolve();
			await until(() => completed);
			await pending;
			expect({ completed, interrupted }).toEqual({ completed: true, interrupted: false });
		});
	});

	describe("route registration", () => {
		it("registers every route uninterruptible", async () => {
			type Added = { method: string; path: string; uninterruptible: boolean };
			const added: Added[] = [];
			const spyRouter = Layer.effect(
				HttpRouter.HttpRouter,
				Effect.map(
					HttpRouter.make,
					(router): HttpRouter.HttpRouter => ({
						...router,
						addAll: routes => {
							for (const route of routes) {
								added.push({
									method: String(route.method),
									path: String(route.path),
									uninterruptible: route.uninterruptible,
								});
							}
							return router.addAll(routes);
						},
					})
				)
			);
			const scope = Effect.runSync(Scope.make());
			await Effect.runPromise(
				Layer.buildWithScope(
					appLayer.pipe(Layer.provide(testServicesLayer()), Layer.provide(spyRouter)),
					scope
				)
			);
			await Effect.runPromise(Scope.close(scope, Exit.void));

			const api = added.filter(route => route.path.startsWith("/api"));
			expect(api).toHaveLength(50);
			for (const route of api) {
				expect(
					[route.method, route.path, route.uninterruptible],
					`${route.method} ${route.path}`
				).toEqual([route.method, route.path, true]);
			}
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

		it("requires bearer auth on every operation", async () => {
			const response = await build()(new Request("http://localhost/docs/json"));
			const document = (await response.json()) as OpenApiPaths;

			const operations = operationKeys(document);
			// Guards against the loop silently passing over an empty or shrunken set.
			expect(operations).toHaveLength(50);
			expect(operationsWithoutBearer(document)).toEqual([]);
		});
	});

	describe("request logging", () => {
		const path = `/api/organizations/${organizationId.toString()}`;
		const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;
		const accessLine = () => logs.find(entry => "http.status" in entry.annotations);

		describe("aborted requests", () => {
			it("logs the status an aborted request produced, not a 499 or a 500", async () => {
				const gate = deferred();
				const started = deferred();
				const service = stub({
					getOrganization: () =>
						Effect.promise(() => {
							started.resolve();
							return gate.promise;
						}).pipe(Effect.as(organization)),
				});
				const controller = new AbortController();
				const pending = build(service)(
					new Request(`http://localhost${path}`, {
						headers: { authorization: `Bearer ${token()}` },
						signal: controller.signal,
					})
				).catch(() => undefined);
				await started.promise;
				controller.abort();
				await new Promise(r => setTimeout(r, 50));
				gate.resolve();
				await until(() => accessLine() !== undefined);
				await pending;
				expect(accessLine()?.annotations["http.status"]).toBe(200);
				expect(logs.some(entry => entry.level === "Error")).toBe(false);
			});
		});

		describe("request correlation", () => {
			const withId = (id?: string) =>
				new Request(`http://localhost${path}`, {
					headers: {
						authorization: `Bearer ${token()}`,
						...(id === undefined ? {} : { "x-request-id": id }),
					},
				});

			it("annotates the access line with a minted uuid when no id is supplied", async () => {
				await build()(withId());
				const annotations = accessLine()?.annotations;
				expect(annotations?.["http.request_id"]).toMatch(uuidV7);
				// The in-memory web handler has no socket, so no remote address is provided.
				expect(annotations).not.toHaveProperty("http.remote_address");
			});

			it("annotates the access line with the socket remote address on a real connection", async () => {
				const { port, close } = await listen({}, capture);
				try {
					await sendRequest(port, { path: "/health" });
					await until(() => accessLine() !== undefined);
				} finally {
					await close();
				}
				const annotations = accessLine()?.annotations;
				expect(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).toContain(
					annotations?.["http.remote_address"]
				);
				expect(annotations?.["http.request_id"]).toMatch(uuidV7);
			});

			it.each([["abc-123_DEF.4:5"], ["has spaces"], ["x".repeat(200)], [""]])(
				"never uses a client-supplied x-request-id (%j) as the correlation key",
				async id => {
					await build()(withId(id));
					const requestId = accessLine()?.annotations["http.request_id"];
					expect(requestId).toMatch(uuidV7);
					expect(requestId).not.toBe(id);
				}
			);

			it("correlates an auth failure with its access line", async () => {
				await build()(new Request("http://localhost/api/organizations"));
				const failure = logs.find(entry => entry.text.includes("Missing bearer credential"));
				expect(failure?.annotations["http.request_id"]).toMatch(uuidV7);
				expect(accessLine()?.annotations["http.request_id"]).toBe(
					failure?.annotations["http.request_id"]
				);
			});

			it("correlates a declared 5xx cause line with its access line", async () => {
				const service = stub({
					getOrganization: () => Effect.fail(new ServiceUnavailableError("down")),
				});
				const response = await build(service)(withId());
				expect(response.status).toBe(503);
				await until(() => logs.some(entry => entry.level === "Error"));
				const cause = logs.find(entry => entry.level === "Error");
				expect(cause?.annotations["http.request_id"]).toMatch(uuidV7);
				expect(accessLine()?.annotations["http.request_id"]).toBe(
					cause?.annotations["http.request_id"]
				);
			});
		});
	});
});

describe("Inbound trace context", () => {
	const traceIdFor = async (headers: Record<string, string>) => {
		const server = await listen();
		try {
			const response = await sendRequest(server.port, { path: "/api/nope", headers });
			expect(response.status).toBe(404);
			return (JSON.parse(response.body) as { traceId: string }).traceId;
		} finally {
			await server.close();
		}
	};

	it("continues a valid unsampled W3C trace", async () => {
		const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
		expect(await traceIdFor({ traceparent: `00-${traceId}-00f067aa0ba902b7-00` })).toBe(traceId);
	});

	it("continues a valid B3 trace and pads a 64-bit trace id to 128 bits", async () => {
		expect(
			await traceIdFor({ "x-b3-traceid": "463ac35c9f6413ad", "x-b3-spanid": "a2fb4a1d1a96d312" })
		).toBe("0000000000000000463ac35c9f6413ad");
		expect(await traceIdFor({ b3: "463ac35c9f6413ad463ac35c9f6413ad-a2fb4a1d1a96d312-1" })).toBe(
			"463ac35c9f6413ad463ac35c9f6413ad"
		);
	});

	it("ignores malformed B3 context and starts a new trace", async () => {
		const fresh = /^[0-9a-f]{32}$/;
		expect(await traceIdFor({ "x-b3-traceid": "zz", "x-b3-spanid": "zz" })).toMatch(fresh);
		expect(await traceIdFor({ b3: "zz-zz-1" })).toMatch(fresh);
		expect(await traceIdFor({ "x-b3-traceid": "463ac35c9f6413ad", "x-b3-spanid": "zz" })).toMatch(
			fresh
		);
	});
});
