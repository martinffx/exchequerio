import type { FastifyPluginAsync } from "fastify"
import { Type } from "@sinclair/typebox"
import { TypeID } from "typeid-js"

import {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	PaginationQuery,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
} from "@/routes/schema"
import { LedgerAccountEntity } from "@/services/entities"
import {
	type CreateLedgerAccountRequest,
	type DeleteLedgerAccountRequest,
	type GetLedgerAccountRequest,
	LedgerAccountIdParams,
	LedgerAccountRequest,
	LedgerAccountResponse,
	type UpdateLedgerAccountRequest,
	type ListLedgerAccountsRequest,
} from "./schema"

const TAGS = ["Ledger Accounts"]
const LedgerAccountRoutes: FastifyPluginAsync = async server => {
	server.get(
		"/",
		{
			schema: {
				operationId: "listLedgerAccounts",
				tags: TAGS,
				summary: "List Ledger Accounts",
				description: "List ledger accounts",
				querystring: PaginationQuery,
				response: {
					200: Type.Array(LedgerAccountResponse),
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
		},
		async (rq: ListLedgerAccountsRequest): Promise<LedgerAccountResponse[]> => {
			const accounts = await rq.server.services.ledgerAccountService.listLedgerAccounts(
				TypeID.fromString<"org">(rq.query.orgId),
				TypeID.fromString<"lgr">(rq.query.ledgerId),
				rq.query.offset,
				rq.query.limit
			)
			return accounts.map(account => account.toResponse())
		}
	)

	server.get(
		"/:ledgerAccountId",
		{
			schema: {
				operationId: "getLedgerAccount",
				tags: TAGS,
				summary: "Get Ledger Account",
				description: "Get ledger account",
				params: LedgerAccountIdParams,
				response: {
					200: LedgerAccountResponse,
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
		async (rq: GetLedgerAccountRequest): Promise<LedgerAccountResponse> => {
			// TODO: Get orgId and ledgerId from request context or params
			// For now, using placeholder values - this needs to be fixed based on route structure
			const orgId = TypeID.fromString<"org">("placeholder")
			const ledgerId = TypeID.fromString<"lgr">("placeholder")
			const ledger = await rq.server.services.ledgerAccountService.getLedgerAccount(
				orgId,
				ledgerId,
				TypeID.fromString<"lat">(rq.params.ledgerAccountId)
			)
			return ledger.toResponse()
		}
	)

	server.post(
		"/",
		{
			schema: {
				operationId: "createLedgerAccount",
				tags: TAGS,
				summary: "Create Ledger Account",
				description: "Create ledger account",
				body: LedgerAccountRequest,
				response: {
					200: LedgerAccountResponse,
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
		async (rq: CreateLedgerAccountRequest): Promise<LedgerAccountResponse> => {
			// TODO: Get orgId from request context or auth
			const orgId = TypeID.fromString<"org">("placeholder")
			const ledgerId = TypeID.fromString<"lgr">("placeholder")
			const entity = LedgerAccountEntity.fromRequest(rq.body, ledgerId, "debit")
			const ledger = await rq.server.services.ledgerAccountService.createLedgerAccount(orgId, entity)
			return ledger.toResponse()
		}
	)

	server.put(
		"/:ledgerAccountId",
		{
			schema: {
				operationId: "updateLedgerAccount",
				tags: TAGS,
				summary: "Update Ledger Account",
				description: "Update ledger account",
				params: LedgerAccountIdParams,
				body: LedgerAccountRequest,
				response: {
					200: LedgerAccountResponse,
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
		},
		async (rq: UpdateLedgerAccountRequest): Promise<LedgerAccountResponse> => {
			// TODO: Get orgId and ledgerId from request context
			const orgId = TypeID.fromString<"org">("placeholder")
			const ledgerId = TypeID.fromString<"lgr">("placeholder")
			const entity = LedgerAccountEntity.fromRequest(
				rq.body,
				ledgerId,
				"debit", // Default normal balance - should come from existing account
				rq.params.ledgerAccountId
			)
			const org = await rq.server.services.ledgerAccountService.updateLedgerAccount(
				orgId,
				ledgerId,
				entity
			)
			return org.toResponse()
		}
	)

	server.delete(
		"/:ledgerAccountId",
		{
			schema: {
				operationId: "deleteLedgerAccount",
				tags: TAGS,
				summary: "Delete Ledger Account",
				description: "Delete ledger account",
				params: LedgerAccountIdParams,
				response: {
					200: {},
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
		},
		async (rq: DeleteLedgerAccountRequest): Promise<void> => {
			// TODO: Get orgId and ledgerId from request context
			const orgId = TypeID.fromString<"org">("placeholder")
			const ledgerId = TypeID.fromString<"lgr">("placeholder")
			await rq.server.services.ledgerAccountService.deleteLedgerAccount(
				orgId,
				ledgerId,
				TypeID.fromString<"lat">(rq.params.ledgerAccountId)
			)
		}
	)
}

export { LedgerAccountRoutes }
