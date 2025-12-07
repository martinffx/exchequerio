import type { FastifyPluginAsync } from "fastify";
import { LedgerAccountStatementEntity } from "@/services";
import {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
} from "../schema";
import {
	type CreateLedgerAccountStatementRequest,
	type GetLedgerAccountStatementRequest,
	LedgerAccountStatementIdParams as LedgerAccountStatementIdParameters,
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
} from "./schema";

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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:statement:read"]),
		},
		async (rq: GetLedgerAccountStatementRequest): Promise<LedgerAccountStatementResponse> => {
			const statement =
				await rq.server.services.ledgerAccountStatementService.getLedgerAccountStatement(
					rq.params.statementId
				);
			return statement.toResponse();
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:statement:write"]),
		},
		async (rq: CreateLedgerAccountStatementRequest): Promise<LedgerAccountStatementResponse> => {
			const statement =
				await rq.server.services.ledgerAccountStatementService.createLedgerAccountStatement(
					LedgerAccountStatementEntity.fromRequest(rq.body)
				);
			return statement.toResponse();
		}
	);
};

export { LedgerAccountStatementRoutes };
