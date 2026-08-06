import { Cause, Effect, Exit, Option } from "effect";
import type { OrganizationHttpError } from "../organizations/OrganizationHttpErrors";
import { organizationHttpFailure } from "../organizations/OrganizationHttpErrors";
import { problem, type ProblemDetail } from "./ProblemDetails";

interface EffectRequestContext {
	readonly id: string;
	readonly url: string;
	readonly log: { readonly error: (value: unknown, message?: string) => void };
}

type RunEffectResult<A> =
	| { readonly _tag: "Success"; readonly value: A }
	| { readonly _tag: "Failure"; readonly status: number; readonly problem: ProblemDetail };

const runEffect = async <A, E extends OrganizationHttpError>(
	request: EffectRequestContext,
	effect: Effect.Effect<A, E>
): Promise<RunEffectResult<A>> => {
	const exit = await Effect.runPromise(Effect.exit(effect));
	if (Exit.isSuccess(exit)) return { _tag: "Success", value: exit.value };

	const context = { instance: request.url, traceId: request.id };
	const expected = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
	if (expected !== undefined) {
		const failure = organizationHttpFailure(expected, context);
		if (failure.status >= 500) {
			request.log.error(failure.cause ?? exit.cause, "Organization Effect failed");
		}
		return { _tag: "Failure", status: failure.status, problem: failure.problem };
	}

	request.log.error(exit.cause, "Organization Effect defect");
	return {
		_tag: "Failure",
		status: 500,
		problem: problem(context, {
			type: "INTERNAL_SERVER_ERROR",
			status: 500,
			title: "Internal Server Error",
			detail: "The Organization operation could not be completed",
		}),
	};
};

export type { EffectRequestContext, RunEffectResult };
export { runEffect };
