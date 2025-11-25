import type { FastifyPluginAsync } from "fastify"
import {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
} from "../schema"
import {
	type CreateLedgerAccountStatementRequest,
	type GetLedgerAccountStatementRequest,
	LedgerAccountStatementIdParams,
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
} from "./schema"
import { LedgerAccountStatementEntity } from "@/services"

const TAGS = ["Ledger Account Statements"]
const LedgerAccountStatementRoutes: FastifyPluginAsync = async server => {
	server.get(
		"/:ledgerAccountStatmentId",
		{
			schema: {
				operationId: "getLedgerAccountStatement",
				tags: TAGS,
				summary: "Get Ledger Account Statement",
				description: "Get Ledger Account Statement",
				params: LedgerAccountStatementIdParams,
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
		},
		async (rq: GetLedgerAccountStatementRequest): Promise<LedgerAccountStatementResponse> => {
			const category = await rq.server.services.ledgerAccountService.getLedgerAccountStatement(
				rq.params.ledgerAccountStatmentId
			)
			return category.toResponse()
		}
	)

	server.post(
		"/",
		{
			schema: {
				operationId: "createLedgerAccountSettlement",
				tags: TAGS,
				summary: "Create Ledger Account Settlement",
				description: "Create Ledger Account Settlement",
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
		},
		async (rq: CreateLedgerAccountStatementRequest): Promise<LedgerAccountStatementResponse> => {
			const statement = await rq.server.services.ledgerAccountService.createLedgerAccountStatement(
				LedgerAccountStatementEntity.fromRequest(rq.body)
			)
			return statement.toResponse()
		}
	)
}

export { LedgerAccountStatementRoutes }
