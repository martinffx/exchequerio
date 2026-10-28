import "@/lib/luxon";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import fastifyUnderPressure from "@fastify/under-pressure";
import { Cause, Effect, FileSystem, ErrorReporter, Layer, Result, type Types } from "effect";
import {
	HttpIncomingMessage,
	HttpMiddleware,
	HttpRouter,
	HttpServer,
	HttpServerRequest,
	HttpServerError,
	HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiBuilder, HttpApiError, HttpApiSwagger } from "effect/unstable/httpapi";
import fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import { LedgerApi, SchemaErrorTransformLayer } from "@/api";
import { makeAuthenticationLayer, registerAuth } from "@/auth";
import { Config } from "@/config";
import {
	BadRequestError,
	globalErrorHandler,
	HttpError,
	InternalServerError,
	NotFoundError,
} from "@/lib/errors";
import {
	makeServerRuntimeLayer,
	type ServerRuntimeLayerOverrides,
	ServerConfigTag,
	ServerRuntime,
	type ServerRuntimeLayer,
	type ServerRuntimeServices,
} from "@/runtime";
import { AssetRoutes } from "@/domains/assets";
import { OrganizationRoutes } from "@/domains/organizations/OrganizationRoutes";
import { OrganizationServiceTag, type OrganizationService } from "@/domains/organizations";
import { LedgerRoutes } from "@/domains/ledgers";
import { AccountRoutes } from "@/domains/ledgers/accounts";
import { LedgerAccountBalanceMonitorRoutes } from "@/domains/ledgers/accounts/balance-monitors";
import { LedgerAccountStatementRoutes } from "@/domains/ledgers/accounts/statements";
import { LedgerAccountSettlementRoutes } from "@/domains/ledgers/settlements";
import { TransactionRoutes } from "@/domains/ledgers/transactions";
import { LedgerAccountCategoryRoutes } from "@/domains/ledgers/accounts/categories";

const LedgerRouterPlugin: FastifyPluginAsync = async server => {
	await server.register(LedgerAccountCategoryRoutes, {
		prefix: "/:ledgerId/accounts/categories",
	});
	await server.register(LedgerAccountSettlementRoutes, {
		prefix: "/:ledgerId/settlements",
	});
	await server.register(LedgerAccountStatementRoutes, {
		prefix: "/:ledgerId/accounts/:accountId/statements",
	});
	await server.register(LedgerAccountBalanceMonitorRoutes, {
		prefix: "/:ledgerId/accounts/:accountId/balance-monitors",
	});
	await server.register(AccountRoutes, { prefix: "/:ledgerId/accounts" });
	await server.register(TransactionRoutes, {
		prefix: "/:ledgerId/transactions",
	});
	await server.register(LedgerRoutes);
};

const RouterPlugin: FastifyPluginAsync = async server => {
	server.addHook("preHandler", server.auth([server.verifyJWT]));

	await server.register(AssetRoutes, { prefix: "/assets" });
	await server.register(LedgerRouterPlugin, { prefix: "/ledgers" });
};

type ServerOpts = {
	runtimeLayer?: ServerRuntimeLayer;
};

declare module "fastify" {
	interface FastifyInstance {
		config: Config;
		runtime: ServerRuntime<ServerRuntimeServices, never>;
	}
}

const buildServer = async ({ runtimeLayer }: ServerOpts = {}): Promise<FastifyInstance> => {
	const runtime = new ServerRuntime(runtimeLayer ?? makeServerRuntimeLayer(new Config()));
	let runtimeDisposal: Promise<void> | undefined;
	const disposeRuntime = () => (runtimeDisposal ??= runtime.dispose());
	let server: FastifyInstance | undefined;

	try {
		const config = await runtime.runPromise(ServerConfigTag);
		server = fastify<Server, IncomingMessage, ServerResponse>({
			// Node closes idle sockets itself; Fastify 5.11 treats "idle" as force-close here.
			forceCloseConnections: false,
			logger: {
				transport: {
					targets: [
						{
							target: "pino-pretty",
							level: "debug",
							options: {
								colorize: true,
							},
						},
					],
				},
			},
		});
		server.decorate("config", config);
		server.decorate("runtime", runtime);
		server.addHook("onClose", disposeRuntime);
		server.setErrorHandler(globalErrorHandler);

		// Skip under-pressure in test environment to avoid interference with test execution
		if (config.environment !== "test" && !config.environment.startsWith("test-")) {
			await server.register(fastifyUnderPressure, {
				maxEventLoopDelay: 1000,
				maxHeapUsedBytes: 500_000_000,
				maxRssBytes: 1_000_000_000,
				maxEventLoopUtilization: 0.9,
				retryAfter: 50,
				exposeStatusRoute: true,
			});
		}

		server.get("/health", (_request, reply) => {
			reply.send({}).code(200);
		});

		await server.register(fastifySwagger, {
			openapi: {
				openapi: "3.0.0",
				info: {
					title: "Ledger API",
					description: "An API for ledger accounts",
					version: "0.1.0",
				},
				servers: [
					{
						url: "http://localhost:3000",
						description: "Development server",
					},
				],
				tags: [
					{
						name: "Organizations",
						description: "An organization is a tenant on the platform.",
					},
					{
						name: "Ledgers",
						description: "A ledger represents a standard chart of ledger accounts.",
					},
				],
				components: {
					securitySchemes: {
						bearerAuth: {
							type: "apiKey",
							name: "Authorization",
							in: "header",
						},
					},
				},
			},
		});
		await server.register(fastifySwaggerUI, {
			routePrefix: "/docs",
			uiConfig: {
				docExpansion: "list",
				deepLinking: false,
			},
		});

		await registerAuth(server);
		await server.register(RouterPlugin, { prefix: "/api" });

		return server;
	} catch (error) {
		if (server !== undefined) {
			try {
				await server.close();
			} catch {
				await disposeRuntime();
			}
		} else {
			await disposeRuntime();
		}
		throw error;
	}
};

/** Handler layers for the groups served by HttpApi; the remaining groups are still on Fastify. */
const handlerLayers = Layer.mergeAll(OrganizationRoutes);

const problemResponse = (error: HttpError) =>
	HttpServerResponse.jsonUnsafe(error.toProblemDetail(), {
		status: error.statusCode,
		headers:
			error.retryAfterSeconds === undefined
				? undefined
				: { "retry-after": error.retryAfterSeconds.toString() },
	});

/** A sanitised 500: the cause is logged and never exposed. */
const internalServerProblem = (cause: Cause.Cause<unknown>) =>
	Effect.logError("Unhandled request failure", cause).pipe(
		Effect.as(problemResponse(new InternalServerError("Internal Server Error")))
	);

/**
 * Renders everything that escapes the handlers as a problem. Declared errors are encoded inside the
 * handler and never reach here; what does is a defect (a problem thrown by a parser, a response-encode
 * failure, a failure the endpoint does not declare), an unknown route or a router-level error.
 */
const edgeErrors = <R>(
	httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, R>
): Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled, R> =>
	// The middleware contract wants `unhandled` left in the error channel; widening `never` to it is sound.
	Effect.catchCause(httpEffect, cause => {
		if (Cause.hasInterrupts(cause)) return Effect.interrupt;
		const failure = Cause.findError(cause);
		if (Result.isSuccess(failure) && HttpServerError.isHttpServerError(failure.success)) {
			const { reason } = failure.success;
			if (reason._tag === "RouteNotFound") {
				return Effect.succeed(
					problemResponse(
						new NotFoundError(`Route ${reason.request.method}:${reason.request.url} not found`)
					)
				);
			}
			if (reason._tag === "RequestParseError") {
				return Effect.succeed(problemResponse(new BadRequestError(reason.message)));
			}
			return internalServerProblem(cause);
		}
		const defect = Cause.findDefect(cause);
		if (Result.isSuccess(defect) && defect.success instanceof HttpError) {
			const problem = defect.success;
			// A 5xx problem is rendered as itself; its cause is logged, never exposed.
			return problem.statusCode >= 500
				? Effect.logError(problem.message, cause).pipe(Effect.as(problemResponse(problem)))
				: Effect.succeed(problemResponse(problem));
		}
		return internalServerProblem(cause);
	}) as Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled, R>;

/**
 * Logs a declared problem with status >= 500 together with its cause, and any failure no endpoint
 * declares (every declared failure is a problem) with its original cause: HttpApi replaces the latter
 * with a schema error before it reaches `EdgeErrors`. Request and response schema errors are not logged
 * here; `EdgeErrors` logs the response ones.
 */
const ServerErrorReporter = ErrorReporter.layer([
	// `error` is a pretty-printed copy, so the failure is read from the cause itself.
	ErrorReporter.make(({ cause, fiber }) => {
		const failure = Cause.findError(cause);
		if (Result.isFailure(failure)) return;
		const error = failure.success;
		if (HttpApiError.HttpApiSchemaError.is(error)) return;
		if (error instanceof HttpError) {
			if (error.statusCode < 500) return;
			Effect.runForkWith(fiber.context)(
				Effect.logError(error.message, Cause.die(error.cause ?? error))
			);
			return;
		}
		Effect.runForkWith(fiber.context)(Effect.logError("Undeclared failure", Cause.fail(error)));
	}),
]);

/**
 * Node's `server.close()` flips `listening` to false at once and then waits for in-flight requests,
 * but does not mark their responses. Tell keep-alive clients to drop the connection while draining.
 * Applied to the final response, so rendered error responses carry it too.
 */
const connectionClose = <E, R>(
	httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
) =>
	Effect.flatMap(httpEffect, response =>
		Effect.map(Effect.service(HttpServerRequest.HttpServerRequest), request => {
			const source = request.source as { socket?: { server?: { listening?: boolean } } };
			return source.socket?.server?.listening === false
				? HttpServerResponse.setHeader(response, "connection", "close")
				: response;
		})
	);

const maxBodyBytes = 1_048_576;

/**
 * Fastify's bodyLimit was 1 MiB and answered a larger body with a 500 problem. Effect's `MaxBodySize`
 * aborts the read mid-stream and destroys the socket, so the client would get no response at all;
 * rejecting on the declared `content-length` first restores the problem response. `MaxBodySize` still
 * bounds bodies without a declared length (chunked), which end the connection instead.
 */
const bodyLimit = <E, R>(httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
	Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), request =>
		Number(request.headers["content-length"]) > maxBodyBytes
			? Effect.logWarning("Request body exceeds the 1 MiB limit").pipe(
					Effect.as(problemResponse(new InternalServerError("Internal Server Error")))
				)
			: httpEffect
	);

/**
 * The one global middleware, with an explicit order: the logger wraps `connectionClose`, which wraps
 * `bodyLimit` and `edgeErrors`, so the logged status is the one sent and every response, rendered errors included,
 * is marked while draining.
 */
const EdgeMiddleware = HttpRouter.middleware(
	Effect.succeed(httpEffect =>
		HttpMiddleware.logger(connectionClose(bodyLimit(edgeErrors(httpEffect))))
	),
	{ global: true }
);

const HealthRoute = HttpRouter.add("GET", "/health", HttpServerResponse.jsonUnsafe({}));

/** The HTTP app: needs the services its handlers use and the server `Config`. */
const appLayer = Layer.mergeAll(
	HttpApiBuilder.layer(LedgerApi, { openapiPath: "/docs/json" }),
	HttpApiSwagger.layer(LedgerApi, { path: "/docs" }),
	HealthRoute,
	EdgeMiddleware,
	ServerErrorReporter
).pipe(
	Layer.provide(handlerLayers),
	Layer.provide(SchemaErrorTransformLayer),
	Layer.provide(
		Layer.unwrap(Effect.map(ServerConfigTag, config => makeAuthenticationLayer(config.jwtSecret)))
	),
	// Fastify's bodyLimit was 1 MiB; Effect's default is unlimited.
	Layer.provide(Layer.succeed(HttpIncomingMessage.MaxBodySize, FileSystem.Size(maxBodyBytes))),
	Layer.provide(HttpServer.layerServices)
);

const makeServerLayer = (config: Config, overrides: ServerRuntimeLayerOverrides = {}) =>
	appLayer.pipe(Layer.provide(makeServerRuntimeLayer(config, overrides)));

type TestStubs = {
	readonly organization?: OrganizationService;
};

/** A service whose every method dies, so a route test fails loudly if it reaches an unstubbed service. */
const dieIfCalled = <S extends object>(name: string): S =>
	new Proxy({} as S, {
		get: (_target, property) => () =>
			Effect.die(new Error(`${name}.${String(property)} called without a test stub`)),
	});

/** Serves the HTTP app over a web `Request`/`Response` handler with stubbed services and no sockets. */
const makeTestWebHandler = (
	stubs: TestStubs = {},
	/** Extra context for the request fibers, e.g. a capturing `Logger.layer`. */
	extra: Layer.Layer<never> = Layer.empty
) => {
	const config = new Config();
	const services = Layer.mergeAll(
		Layer.succeed(ServerConfigTag, config),
		Layer.succeed(
			OrganizationServiceTag,
			stubs.organization ?? dieIfCalled<OrganizationService>("OrganizationService")
		)
	);
	return HttpRouter.toWebHandler(Layer.provideMerge(appLayer.pipe(Layer.provide(services)), extra), {
		disableLogger: true,
	});
};

export type { TestStubs };
export { appLayer, buildServer, makeServerLayer, makeTestWebHandler };
