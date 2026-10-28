import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NotFoundError } from "@/lib/errors";

describe("toProblemDetail traceId", () => {
	const problem = Effect.sync(() => new NotFoundError("x").toProblemDetail());

	it("uses the current span's trace id", async () => {
		const result = await Effect.runPromise(
			Effect.flatMap(Effect.currentSpan, span =>
				Effect.map(problem, detail => ({ detail, spanTraceId: span.traceId }))
			).pipe(Effect.withSpan("test"))
		);
		expect(result.detail.traceId).toBe(result.spanTraceId);
	});

	it("falls back to a uuid outside any span", async () => {
		const detail = await Effect.runPromise(problem);
		expect(detail.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});
});
