import { Cause, Effect, Exit, Option } from "effect";
import { problem, type ProblemContext, type ProblemDetail } from "./ProblemDetails";

interface EffectRequestContext {
	readonly id: string;
	readonly url: string;
	readonly log: { readonly error: (value: unknown, message?: string) => void };
}

type RunEffectResult<A> =
	| { readonly _tag: "Success"; readonly value: A }
	| { readonly _tag: "Failure"; readonly status: number; readonly problem: ProblemDetail };

interface EffectRuntime<R> {
	readonly runPromise: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}

interface HttpEffectFailure {
	readonly status: number;
	readonly problem: ProblemDetail;
	readonly cause?: unknown;
}

interface RunEffectOptions<E> {
	readonly mapError: (error: E, context: ProblemContext) => HttpEffectFailure;
	readonly operation: string;
	readonly defectDetail: string;
}

const runEffect = async <A, E, R>(
	runtime: EffectRuntime<R>,
	request: EffectRequestContext,
	effect: Effect.Effect<A, E, R>,
	options: RunEffectOptions<E>
): Promise<RunEffectResult<A>> => {
	const exit = await runtime.runPromise(Effect.exit(effect));
	if (Exit.isSuccess(exit)) return { _tag: "Success", value: exit.value };

	const context = { instance: request.url, traceId: request.id };
	const expected = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
	if (expected !== undefined) {
		const failure = options.mapError(expected, context);
		if (failure.status >= 500) {
			request.log.error(failure.cause ?? exit.cause, `${options.operation} failed`);
		}
		return { _tag: "Failure", status: failure.status, problem: failure.problem };
	}

	request.log.error(exit.cause, `${options.operation} defect`);
	return {
		_tag: "Failure",
		status: 500,
		problem: problem(context, {
			type: "INTERNAL_SERVER_ERROR",
			status: 500,
			title: "Internal Server Error",
			detail: options.defectDetail,
		}),
	};
};

export type {
	EffectRequestContext,
	EffectRuntime,
	HttpEffectFailure,
	RunEffectOptions,
	RunEffectResult,
};
export { runEffect };
