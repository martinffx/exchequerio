import { Duration, Effect, Formatter, Layer, Logger } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/unstable/http";
import { Otlp, OtlpSerialization } from "effect/unstable/observability";

// Formatter.formatJson tolerates bigint and circular values; loggers run unguarded in the calling effect.
// Plain `Logger.consoleJson` omits the active span, so production logs add it for trace correlation.
const jsonWithTrace = Logger.withConsoleLog(
	Logger.make(options => {
		const span = options.fiber.currentSpan;
		return Formatter.formatJson({
			...Logger.formatStructured.log(options),
			traceId: span?.traceId,
			spanId: span?.spanId,
		});
	})
);

// Logger.layer replaces Effect's default console logger; the OTLP logger merges with it, so console
// logs stay on whether or not export is enabled. Export is driven by the OTEL_* environment.
const consoleLoggerLayer = (environment: string) =>
	Logger.layer([environment === "production" ? jsonWithTrace : Logger.consolePretty()]);

// The exporter only disables itself after a failed export, so a collector that accepts connections
// and never answers would otherwise hold every forked export and its batch in memory.
export const makeExporterClient = (timeout: Duration.Input) =>
	Layer.effect(
		HttpClient.HttpClient,
		Effect.map(HttpClient.HttpClient, client =>
			client.pipe(
				HttpClient.transform((response, request) =>
					Effect.timeoutOrElse(response, {
						duration: timeout,
						// A transport error is transient, so the exporter retries and then disables itself.
						orElse: () =>
							Effect.fail(
								new HttpClientError.HttpClientError({
									reason: new HttpClientError.TransportError({
										request,
										description: "Export timed out",
									}),
								})
							),
					})
				)
			)
		)
	).pipe(Layer.provide(FetchHttpClient.layer));

export const makeTelemetryLayer = (options: { serviceName: string; environment: string }) =>
	// deployment.environment.name comes from OTEL_RESOURCE_ATTRIBUTES; NODE_ENV only picks the log format.
	Otlp.layerFromConfig({ resource: { serviceName: options.serviceName } }).pipe(
		Layer.provideMerge(consoleLoggerLayer(options.environment)),
		Layer.provide(OtlpSerialization.layerProtobuf),
		Layer.provide(makeExporterClient("10 seconds"))
	);
