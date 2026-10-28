import { Formatter, Layer, Logger } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
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

export const makeTelemetryLayer = (options: { serviceName: string; environment: string }) =>
	Otlp.layerFromConfig({
		resource: {
			serviceName: options.serviceName,
			attributes: { "deployment.environment.name": options.environment },
		},
	}).pipe(
		Layer.provideMerge(consoleLoggerLayer(options.environment)),
		Layer.provide(OtlpSerialization.layerProtobuf),
		Layer.provide(FetchHttpClient.layer)
	);
