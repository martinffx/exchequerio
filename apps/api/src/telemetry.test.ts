import { ConfigProvider, Console, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { makeTelemetryLayer } from "@/telemetry";

// Pinned provider: a developer shell may have OTEL_* set.
const make = (env: Record<string, string>, environment = "test") =>
	makeTelemetryLayer({ serviceName: "exchequer-test", environment }).pipe(
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)))
	);

const run = <A>(layer: ReturnType<typeof make>, effect: Effect.Effect<A, unknown>) =>
	Effect.runPromise(effect.pipe(Effect.provide(layer)));

const collectingConsole = (lines: Array<unknown>) => ({
	...console,
	log: (line: unknown) => {
		lines.push(line);
	},
});

describe("makeTelemetryLayer", () => {
	it("builds, runs and tears down with no OTEL_* configured", async () => {
		await expect(run(make({}), Effect.succeed("ok"))).resolves.toBe("ok");
	});

	it("tolerates an unreachable endpoint and shuts down within the exporter timeout", async () => {
		const layer = make({
			OTEL_TRACES_EXPORTER: "otlp",
			OTEL_METRICS_EXPORTER: "otlp",
			OTEL_LOGS_EXPORTER: "otlp",
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
			OTEL_EXPORTER_OTLP_TIMEOUT: "500",
			OTEL_BLRP_SCHEDULE_DELAY: "50",
		});
		const started = Date.now();
		const program = Effect.logInfo("hello").pipe(
			Effect.withSpan("work"),
			Effect.as("ok"),
			Effect.provideService(Console.Console, { ...console, log: () => {} })
		);
		await expect(run(layer, program)).resolves.toBe("ok");
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it("adds traceId and spanId to production JSON logs", async () => {
		const lines: Array<unknown> = [];
		const program = Effect.gen(function* () {
			const span = yield* Effect.currentSpan;
			yield* Effect.logInfo("hello");
			return span;
		}).pipe(
			Effect.withSpan("work"),
			Effect.provideService(Console.Console, {
				...console,
				log: (line: unknown) => {
					lines.push(line);
				},
			})
		);
		const span = await run(make({}, "production"), program);
		const entry: unknown = JSON.parse(String(lines[0]));
		expect(entry).toMatchObject({ message: "hello", traceId: span.traceId, spanId: span.spanId });
	});

	it("logs bigint values in production JSON without failing the calling effect", async () => {
		const lines: Array<unknown> = [];
		const program = Effect.logInfo("x", { amount: 10n }).pipe(
			Effect.as("ok"),
			Effect.provideService(Console.Console, collectingConsole(lines))
		);
		await expect(run(make({}, "production"), program)).resolves.toBe("ok");
		expect(String(lines[0])).toContain("10");
	});

	it("logs circular objects in production JSON without failing the calling effect", async () => {
		const lines: Array<unknown> = [];
		const circular: Record<string, unknown> = { name: "loop" };
		circular.self = circular;
		const program = Effect.logInfo("x", { error: circular }).pipe(
			Effect.as("ok"),
			Effect.provideService(Console.Console, collectingConsole(lines))
		);
		await expect(run(make({}, "production"), program)).resolves.toBe("ok");
		expect(lines).toHaveLength(1);
	});
});
