import "@/lib/luxon";
import { createServer } from "node:http";
import {
	Cause,
	Effect,
	FileSystem,
	ErrorReporter,
	Layer,
	Option,
	Result,
	type Types,
} from "effect";
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
import { v7 as uuid } from "uuid";
import { LedgerApi, SchemaErrorTransformLayer } from "@/api";
import { makeAuthenticationLayer } from "@/auth";
import {
	BadRequestError,
	HttpError,
	InternalServerError,
	NotFoundError,
	retryAfterHeaders,
} from "@/lib/errors";
import { ServerConfigTag } from "@/runtime";
import { AssetRoutes } from "@/domains/assets/AssetRoutes";
import { AccountRoutes } from "@/domains/ledgers/accounts/AccountRoutes";
import { LedgerAccountCategoryRoutes } from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryRoutes";
import { LedgerAccountStatementRoutes } from "@/domains/ledgers/accounts/statements/LedgerAccountStatementRoutes";
import { LedgerAccountBalanceMonitorRoutes } from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorRoutes";
import { LedgerRoutes } from "@/domains/ledgers/LedgerRoutes";
import { LedgerAccountSettlementRoutes } from "@/domains/ledgers/settlements/LedgerAccountSettlementRoutes";
import { TransactionRoutes } from "@/domains/ledgers/transactions/LedgerTransactionRoutes";
import { OrganizationRoutes } from "@/domains/organizations/OrganizationRoutes";

/**
 * The server keeps the pre-migration timeouts: 72 s keep-alive (the load balancer idle timeout must
 * stay below it) and no request timeout. `headersTimeout` is explicit because Node derives it as
 * `min(60_000, requestTimeout)` when `requestTimeout` is passed to the constructor, which would
 * turn it off; the old server assigned `requestTimeout` afterwards and so kept 60 s.
 */
const createHttpServer = () =>
	createServer({ keepAliveTimeout: 72_000, requestTimeout: 0, headersTimeout: 60_000 });

/** Handler layers for the groups served by HttpApi. */
const handlerLayers = Layer.mergeAll(
	OrganizationRoutes,
	LedgerRoutes,
	AssetRoutes,
	AccountRoutes,
	TransactionRoutes,
	LedgerAccountSettlementRoutes,
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
		// Every `/api` handler runs to completion, so a client abort or drain cut never interrupts one.
		if (Cause.hasInterrupts(cause)) return Effect.interrupt;
		const failure = Cause.findError(cause);
		if (Result.isSuccess(failure) && HttpServerError.isHttpServerError(failure.success)) {
			const { reason } = failure.success;
			// review-decision: a malformed percent-encoded path or a segment over 100 characters renders as this 404 where the old server answered 400 and 414 — Effect's router returns no match for both and only invalid requests are affected. Reconsider if a client or monitor treats 404 as "resource gone" for such paths.
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
 * bounds bodies without a declared length (chunked), which end the connection instead. The response
 * carries `connection: close` so Node does not keep the socket alive to read the rest of the body.
 */
const bodyLimit = <E, R>(httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
	Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), request =>
		Number(request.headers["content-length"]) > maxBodyBytes
			? Effect.logWarning("Request body exceeds the 1 MiB limit").pipe(
					Effect.as(
						HttpServerResponse.setHeader(
							problemResponse(new InternalServerError("Internal Server Error")),
							"connection",
							"close"
						)
					)
				)
			: httpEffect
	);

/**
 * Annotates every log line of a request with a freshly minted id and the client address, the access
 * line, auth failures and error-reporter lines included. A client-supplied `x-request-id` is never
 * trusted as the correlation key. The id is never echoed in a response.
 */
const correlate = <E, R>(httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
	Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), request => {
		const address = request.remoteAddress;
		return Effect.annotateLogs(httpEffect, {
			"http.request_id": uuid(),
			...(Option.isSome(address) ? { "http.remote_address": address.value } : {}),
		});
	});

/**
 * The one global middleware, with an explicit order: `correlate` annotates everything, the logger wraps
 * `connectionClose`, which wraps `bodyLimit` and `edgeErrors`, so the logged status is that of the
 * response edgeErrors renders and every response, rendered errors included, is marked while draining.
 */
const EdgeMiddleware = HttpRouter.middleware(
	Effect.succeed(httpEffect =>
		correlate(HttpMiddleware.logger(connectionClose(bodyLimit(edgeErrors(httpEffect)))))
	),
	{ global: true }
);

const HealthRoute = HttpRouter.add("GET", "/health", HttpServerResponse.jsonUnsafe({}));

/** The HTTP app: needs the services its handlers use and the server `Config`. */
const appLayer = Layer.mergeAll(
	HttpApiBuilder.layer(LedgerApi, { openapiPath: "/docs/json" }),
	// review-decision: only /docs and /docs/json are served — the old swagger-ui plugin also served /docs/yaml and its static sub-routes, which now return the 404 problem; no consumer was found. Reconsider if a tool or pipeline needs the spec as YAML.
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

const shutdownLog = (message: string) =>
	Layer.effectDiscard(Effect.addFinalizer(() => Effect.logInfo(message)));

/**
 * Serves the app on `server` with `services` (the one composition used by the entrypoint and the
 * tests). Layers are built outermost-first and released in reverse: services are built before the
 * port opens and released after the drain; "started" is the first finalizer to run, "complete" the last.
 */
const serveApp = <SO, SE, SR, VO, VE, VR>(
	server: Layer.Layer<SO, SE, SR>,
	services: Layer.Layer<VO, VE, VR>
) =>
	// Built after the router, so its finalizer runs before the router's release (which drains in-flight requests).
	// review-decision: once shutdown starts the request listener is removed before server.close(), so a pipelined request or one on a keep-alive socket that was not reaped gets no answer until the process exits after the drain (the old server answered 503); it was never processed, so a retry is safe. Reconsider if a load balancer reuses upstream connections during deploys and ambiguous resets are reported.
	shutdownLog("API shutdown started").pipe(
		// HttpMiddleware.logger is already a global middleware of the app, so the router's own logger is off.
		Layer.provideMerge(
			// review-decision: routing keeps Effect's defaults (case-insensitive, duplicate slashes collapsed, trailing slash ignored) — the only effect is that spellings the old server answered 404 are now served; no route is exposed that was not already registered. Reconsider if a gateway, WAF or auth rule keys on exact-case paths, or if clients are found relying on 404s for those spellings.
			HttpRouter.serve(appLayer, { disableLogger: true })
		),
		Layer.provide(server),
		Layer.provide(services),
		Layer.provide(shutdownLog("API shutdown complete"))
	);

export { appLayer, createHttpServer, serveApp };
