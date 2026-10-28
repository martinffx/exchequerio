import "@/lib/luxon";
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
import { LedgerApi, SchemaErrorTransformLayer } from "@/api";
import { makeAuthenticationLayer } from "@/auth";
import { Config } from "@/config";
import {
	BadRequestError,
	HttpError,
	InternalServerError,
	NotFoundError,
	retryAfterHeaders,
} from "@/lib/errors";
import { makeServerRuntimeLayer, ServerConfigTag } from "@/runtime";
import { AssetRoutes } from "@/domains/assets/AssetRoutes";
import { AccountRoutes } from "@/domains/ledgers/accounts/AccountRoutes";
import { LedgerAccountCategoryRoutes } from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryRoutes";
import { LedgerAccountStatementRoutes } from "@/domains/ledgers/accounts/statements/LedgerAccountStatementRoutes";
import { LedgerAccountBalanceMonitorRoutes } from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorRoutes";
import { LedgerRoutes } from "@/domains/ledgers/LedgerRoutes";
import { SettlementRoutes } from "@/domains/ledgers/settlements/LedgerAccountSettlementRoutes";
import { TransactionRoutes } from "@/domains/ledgers/transactions/LedgerTransactionRoutes";
import { OrganizationRoutes } from "@/domains/organizations/OrganizationRoutes";

/** Handler layers for the groups served by HttpApi. */
const handlerLayers = Layer.mergeAll(
	OrganizationRoutes,
	LedgerRoutes,
	AssetRoutes,
	AccountRoutes,
	TransactionRoutes,
	SettlementRoutes,
	LedgerAccountCategoryRoutes,
	LedgerAccountStatementRoutes,
	LedgerAccountBalanceMonitorRoutes
);

const problemResponse = (error: HttpError) =>
	HttpServerResponse.jsonUnsafe(error.toProblemDetail(), {
		status: error.statusCode,
		headers: Object.fromEntries(
			Object.entries(retryAfterHeaders(error)).map(([name, seconds]) => [name, String(seconds)])
		),
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
 * The body limit is 1 MiB and a larger body is answered with a 500 problem (kept at 500, not 413,
 * for parity with the pre-migration server). Effect's `MaxBodySize`
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
	// Request bodies are limited to 1 MiB (the pre-migration limit); Effect's default is unlimited.
	Layer.provide(Layer.succeed(HttpIncomingMessage.MaxBodySize, FileSystem.Size(maxBodyBytes))),
	Layer.provide(HttpServer.layerServices)
);

const makeServerLayer = (config: Config) =>
	appLayer.pipe(Layer.provide(makeServerRuntimeLayer(config)));

export { appLayer, makeServerLayer };
