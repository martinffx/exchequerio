import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type Redis from "ioredis";
import { problem, type ProblemDetail } from "../http/ProblemDetails";

type OrganizationLimitCheck =
	| { readonly isAllowed: true; readonly key: string }
	| {
			readonly isAllowed: false;
			readonly key: string;
			readonly max: number;
			readonly timeWindow: number;
			readonly remaining: number;
			readonly ttl: number;
			readonly ttlInSeconds: number;
			readonly isExceeded: boolean;
			readonly isBanned: boolean;
	  };
type OrganizationLimiter = (request: FastifyRequest) => Promise<OrganizationLimitCheck>;
type OrganizationRateLimitResult =
	| { readonly _tag: "Allowed" }
	| { readonly _tag: "Failure"; readonly status: 429 | 503; readonly problem: ProblemDetail };

declare module "fastify" {
	interface FastifyInstance {
		organizationRateLimit: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
	}
}

const applyOrganizationRateLimit = async (
	limiter: OrganizationLimiter,
	request: FastifyRequest,
	reply: Pick<FastifyReply, "header">
): Promise<OrganizationRateLimitResult> => {
	try {
		const result = await limiter(request);
		if (result.isAllowed) return { _tag: "Allowed" };

		reply.header("x-ratelimit-limit", result.max);
		reply.header("x-ratelimit-remaining", result.remaining);
		reply.header("x-ratelimit-reset", result.ttlInSeconds);
		if (!result.isExceeded) return { _tag: "Allowed" };

		reply.header("retry-after", result.ttlInSeconds);
		return {
			_tag: "Failure",
			status: 429,
			problem: problem(
				{ instance: request.url, traceId: request.id },
				{
					type: "TOO_MANY_REQUESTS",
					status: 429,
					title: "Too Many Requests",
					detail: "The Organization request rate limit was exceeded",
				}
			),
		};
	} catch {
		return {
			_tag: "Failure",
			status: 503,
			problem: problem(
				{ instance: request.url, traceId: request.id },
				{
					type: "SERVICE_UNAVAILABLE",
					status: 503,
					title: "Service Unavailable",
					detail: "The Organization rate-limit store is unavailable",
					retryable: true,
				}
			),
		};
	}
};

const registerOrganizationRateLimit = async (
	server: import("fastify").FastifyInstance,
	client: Redis
) => {
	await server.register(fastifyRateLimit, {
		global: false,
		skipOnError: false,
		redis: client,
		nameSpace: `exchequer:${server.config.environment}:organizations:`,
		max: server.config.organizationRateLimitMax,
		timeWindow: server.config.organizationRateLimitWindowMs,
		keyGenerator: request => request.token.orgId.toString(),
	});
	const limiter = server.createRateLimit();
	server.decorate(
		"organizationRateLimit",
		async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
			const result = await applyOrganizationRateLimit(limiter, request, reply);
			if (result._tag === "Failure") {
				await reply.status(result.status).send(result.problem);
			}
		}
	);
};

export type { OrganizationLimiter, OrganizationRateLimitResult };
export { applyOrganizationRateLimit, registerOrganizationRateLimit };
