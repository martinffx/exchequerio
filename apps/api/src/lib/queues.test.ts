import { Effect, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import { withValkeySpan } from "./queues";

const capture = () => {
	const spans: Tracer.NativeSpan[] = [];
	const tracer = Tracer.make({
		span: options => {
			const span = new Tracer.NativeSpan(options);
			spans.push(span);
			return span;
		},
	});
	return { spans, tracer };
};

describe("withValkeySpan", () => {
	it("creates no span without a parent span", async () => {
		const { spans, tracer } = capture();
		const result = await Effect.runPromise(
			withValkeySpan("zrange", Effect.succeed("ok")).pipe(Effect.withTracer(tracer))
		);
		expect(result).toBe("ok");
		expect(spans).toEqual([]);
	});

	it("creates a client child span under a parent span", async () => {
		const { spans, tracer } = capture();
		await Effect.runPromise(
			withValkeySpan("zrange", Effect.void).pipe(Effect.withSpan("parent"), Effect.withTracer(tracer))
		);
		const child = spans.find(({ name }) => name === "valkey.ZRANGE");
		expect(child?.kind).toBe("client");
		expect(Object.fromEntries(child?.attributes ?? [])).toEqual({
			"db.system.name": "valkey",
			"db.operation.name": "ZRANGE",
		});
		expect(child?.parent._tag).toBe("Some");
	});
});
