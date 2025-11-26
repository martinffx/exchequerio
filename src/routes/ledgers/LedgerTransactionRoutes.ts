import { Type } from "@sinclair/typebox"
import type { FastifyPluginAsync } from "fastify"
import { NotImplementedError } from "@/errors"

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

import {
	type CreateLedgerTransactionRequest,
	type DeleteLedgerTransactionRequest,
	type GetLedgerTransactionRequest,
	LedgerTransactionIdParams as LedgerTransactionIdParameters,
	LedgerTransactionRequest,
	LedgerTransactionResponse,
	type ListLedgerTransactionsRequest,
	type UpdateLedgerTransactionRequest,
} from "./schema"

const TAGS = ["Ledger Transactions"]
const LedgerTransactionRoutes: FastifyPluginAsync = server => {
	server.get(
		"/",
		{
			schema: {
				operationId: "listLedgerTransactions",
				tags: TAGS,
				summary: "List Ledger Transactions",
				description: "List ledger transactions",
				querystring: PaginationQuery,
				response: {
					200: Type.Array(LedgerTransactionResponse),
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
		},
		async (rq: ListLedgerTransactionsRequest): Promise<LedgerTransactionResponse[]> => {
			const transactions = await rq.server.services.ledgerTransactionService.listLedgerTransactions(
				rq.query.offset,
				rq.query.limit
			)
			return transactions.map(transaction => transaction.toResponse())
		}
	)

	server.get(
		"/:id",
		{
			schema: {
				operationId: "getLedgerTransaction",
				tags: TAGS,
				summary: "Get Ledger Transaction",
				description: "Get ledger transaction",
				params: LedgerTransactionIdParameters,
				response: {
					200: LedgerTransactionResponse,
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
		async (rq: GetLedgerTransactionRequest): Promise<LedgerTransactionResponse> => {
			const ledger = await rq.server.services.ledgerTransactionService.getLedgerTransaction(
				rq.params.ledgerTransactionId
			)
			return ledger.toResponse()
		}
	)

	server.post(
		"/",
		{
			schema: {
				operationId: "createLedgerTransaction",
				tags: TAGS,
				summary: "Create Ledger Transaction",
				description: "Create ledger transaction",
				body: LedgerTransactionRequest,
				response: {
					200: LedgerTransactionResponse,
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
		async (_rq: CreateLedgerTransactionRequest): Promise<LedgerTransactionResponse> => {
			// TODO: Implement proper entity creation from request body
			throw new NotImplementedError("Feature not yet implemented")
		}
	)

	server.put(
		"/:id",
		{
			schema: {
				operationId: "updateLedgerTransaction",
				tags: TAGS,
				summary: "Update Ledger Transaction",
				description: "Update ledger transaction",
				params: LedgerTransactionIdParameters,
				body: LedgerTransactionRequest,
				response: {
					200: LedgerTransactionResponse,
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
		async (_rq: UpdateLedgerTransactionRequest): Promise<LedgerTransactionResponse> => {
			// TODO: Implement proper entity creation from request body
			throw new NotImplementedError("Feature not yet implemented")
		}
	)

	server.delete(
		"/:id",
		{
			schema: {
				operationId: "deleteLedgerTransaction",
				tags: TAGS,
				summary: "Delete Ledger Transaction",
				description: "Delete ledger transaction",
				params: LedgerTransactionIdParameters,
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
		async (rq: DeleteLedgerTransactionRequest): Promise<void> => {
			await rq.server.services.ledgerTransactionService.deleteLedgerTransaction(
				rq.params.ledgerTransactionId
			)
		}
	)
	return Promise.resolve()
}

export { LedgerTransactionRoutes }
