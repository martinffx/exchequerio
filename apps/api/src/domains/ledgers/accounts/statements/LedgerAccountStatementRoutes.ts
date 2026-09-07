import { Effect, Result } from "effect";
import type { FastifyPluginAsync } from "fastify";

import {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
} from "@/lib/errors";

import {
	type CreateLedgerAccountStatementRequest,
	type GetLedgerAccountStatementRequest,
	LedgerAccountStatementIdParameters,
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
} from "./LedgerAccountStatementSchema";
import { LedgerAccountStatementServiceTag } from "./LedgerAccountStatementService";

const TAGS = ["Ledger Account Statements"];

const LedgerAccountStatementRoutes: FastifyPluginAsync = async server => {
	server.get<{ Params: LedgerAccountStatementIdParameters }>(
		"/:statementId",
		{
			schema: {
				operationId: "getLedgerAccountStatement",
				tags: TAGS,
				summary: "Get Ledger Account Statement",
				description: "Get Ledger Account Statement",
				params: LedgerAccountStatementIdParameters,
				response: {
					200: LedgerAccountStatementResponse,
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			preHandler: server.hasPermissions(["ledger:account:statement:read"]),
		},
		async (request: GetLedgerAccountStatementRequest) => {
			const effect = LedgerAccountStatementServiceTag.use(service =>
				service.getLedgerAccountStatement(request.params.statementId)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: statement => statement.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{ Body: LedgerAccountStatementRequest }>(
		"/",
		{
			schema: {
				operationId: "createLedgerAccountStatement",
				tags: TAGS,
				summary: "Create Ledger Account Statement",
				description: "Create Ledger Account Statement",
				body: LedgerAccountStatementRequest,
				response: {
					200: LedgerAccountStatementResponse,
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			preHandler: server.hasPermissions(["ledger:account:statement:write"]),
		},
		async (request: CreateLedgerAccountStatementRequest) => {
			const effect = LedgerAccountStatementServiceTag.use(service =>
				service.createLedgerAccountStatement(request.body)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: statement => statement.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);
};

export { LedgerAccountStatementRoutes };
