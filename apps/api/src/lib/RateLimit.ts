import { Duration, Effect, Layer } from "effect";
import { HttpApiMiddleware } from "effect/unstable/httpapi";
import { HttpServerResponse } from "effect/unstable/http";
import { RateLimiter } from "effect/unstable/persistence";
import { CurrentToken } from "@/auth";
import { TooManyRequestsApiError } from "@/lib/ApiContract";
import { TooManyRequestsError } from "@/lib/errors";

/** Limits each Organization's requests; runs inside `Authentication`, which provides `CurrentToken`. */
class RateLimit extends HttpApiMiddleware.Service<RateLimit, { requires: CurrentToken }>()(
	"RateLimit",
	{ error: TooManyRequestsApiError }
) {}

const wholeSeconds = (duration: Duration.Duration): number =>
	Math.ceil(Duration.toMillis(duration) / 1000);

/**
 * Consumes one token per request, keyed by Organization. The store refills at `window / limit`, so
 * the limit is not a calendar window. A store failure lets the request through (fail-open), logged
 * once when the outage starts and once when it recovers.
 */
const makeRateLimitLayer = ({
	limit,
	window,
}: {
	readonly limit: number;
	readonly window: Duration.Input;
}): Layer.Layer<RateLimit, never, RateLimiter.RateLimiter> =>
	Layer.effect(
		RateLimit,
		Effect.gen(function* () {
			const limiter = yield* RateLimiter.RateLimiter;
			let failingOpen = false;
			return RateLimit.of(httpEffect =>
				Effect.gen(function* () {
					const token = yield* CurrentToken;
					const consumed = yield* limiter
						.consume({
							key: token.organizationId.toString(),
							limit,
							window,
							algorithm: "token-bucket",
							onExceeded: "fail",
						})
						.pipe(
							Effect.map(result => ({ _tag: "Consumed" as const, result })),
							Effect.catch(error => {
								const { reason } = error;
								if (reason._tag === "RateLimitExceeded") {
									return Effect.fail(
										new TooManyRequestsError("Rate limit exceeded", {
											retryable: true,
											retryAfterSeconds: Math.max(1, wholeSeconds(reason.retryAfter)),
										})
									);
								}
								return Effect.succeed({ _tag: "StoreFailed" as const, reason });
							})
						);
					if (consumed._tag === "StoreFailed") {
						if (!failingOpen) {
							failingOpen = true;
							yield* Effect.logWarning("Rate limit store unavailable; failing open", consumed.reason);
						}
						return yield* httpEffect;
					}
					if (failingOpen) {
						failingOpen = false;
						yield* Effect.logInfo("Rate limit store recovered");
					}
					const { limit: max, remaining, resetAfter } = consumed.result;
					const response = yield* httpEffect;
					return HttpServerResponse.setHeaders(response, {
						"x-ratelimit-limit": String(max),
						"x-ratelimit-remaining": String(remaining),
						"x-ratelimit-reset": String(wholeSeconds(resetAfter)),
					});
				})
			);
		})
	);

export { RateLimit, makeRateLimitLayer };
