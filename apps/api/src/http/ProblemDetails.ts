interface ProblemDetail {
	readonly type: string;
	readonly status: number;
	readonly title: string;
	readonly detail: string;
	readonly instance: string;
	readonly traceId: string;
	readonly organizationId?: string;
	readonly retryable?: boolean;
}

interface ProblemContext {
	readonly instance: string;
	readonly traceId: string;
}

const problem = (
	context: ProblemContext,
	fields: Omit<ProblemDetail, "instance" | "traceId">
): ProblemDetail => ({ ...fields, ...context });

const ProblemDetailSchema = Type.Object({
	type: Type.String(),
	status: Type.Integer(),
	title: Type.String(),
	detail: Type.String(),
	instance: Type.String(),
	traceId: Type.String(),
	organizationId: Type.Optional(Type.String()),
	retryable: Type.Optional(Type.Boolean()),
});

const problemDetailSchema = (type: string, status: number) =>
	Type.Object({
		type: Type.Literal(type),
		status: Type.Literal(status),
		title: Type.String(),
		detail: Type.String(),
		instance: Type.String(),
		traceId: Type.String(),
		organizationId: Type.Optional(Type.String()),
		retryable: Type.Optional(Type.Boolean()),
	});

export type { ProblemContext, ProblemDetail };
export { problem, ProblemDetailSchema, problemDetailSchema };
import { Type } from "@sinclair/typebox";
