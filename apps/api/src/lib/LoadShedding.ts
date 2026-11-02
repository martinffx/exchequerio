import { monitorEventLoopDelay } from "node:perf_hooks";
import { Effect, Ref, Schedule } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { problemResponse } from "@/lib/ApiContract";
import { ServiceUnavailableError } from "@/lib/errors";

const MAX_EVENT_LOOP_DELAY_MS = 1000;
const MAX_HEAP_USED_BYTES = 500 * 1024 * 1024;
const MAX_RSS_BYTES = 1024 * 1024 * 1024;
const RESOLUTION_MS = 10;

/** Pure: true when the process is overloaded. The histogram mean is in nanoseconds. */
export const sample = (
	histogramMeanNs: number,
	resolutionMs: number,
	memoryUsage: Pick<NodeJS.MemoryUsage, "heapUsed" | "rss">
): boolean => {
	const delayMs = histogramMeanNs / 1e6 - resolutionMs;
	return (
		Number.isNaN(delayMs) ||
		delayMs > MAX_EVENT_LOOP_DELAY_MS ||
		memoryUsage.heapUsed > MAX_HEAP_USED_BYTES ||
		memoryUsage.rss > MAX_RSS_BYTES
	);
};

/** Answers 503 without running the handler while the verdict says the process is overloaded. */
export const shedLoad =
	(overloaded: Effect.Effect<boolean>) =>
	<E, R>(httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
		Effect.flatMap(overloaded, shed =>
			shed
				? Effect.succeed(
						problemResponse(
							new ServiceUnavailableError("Service under pressure", {
								retryable: true,
								retryAfterSeconds: 50,
							})
						)
					)
				: httpEffect
		);

/** Samples event-loop delay and memory every second; the returned effect reads the latest verdict. */
export const startSampler = Effect.gen(function* () {
	const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
	histogram.enable();
	yield* Effect.addFinalizer(() => Effect.sync(() => void histogram.disable()));
	const verdict = yield* Ref.make(false);
	const takeSample = Effect.suspend(() => {
		const overloaded = sample(histogram.mean, RESOLUTION_MS, process.memoryUsage());
		histogram.reset();
		return Ref.set(verdict, overloaded);
	});
	// First sample after one full interval: the histogram is empty (NaN mean) until then.
	yield* Effect.forkScoped(
		Effect.andThen(
			Effect.sleep("1 second"),
			Effect.repeat(
				Effect.catchDefect(takeSample, defect => Effect.logWarning("Load sample failed", defect)),
				Schedule.spaced("1 second")
			)
		)
	);
	return Ref.get(verdict);
});
