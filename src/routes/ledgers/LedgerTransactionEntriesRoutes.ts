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
	type GetLedgerTransactionEntryRequest,
	LedgerTransactionEntryIdParams as LedgerTransactionEntryIdParameters,
	LedgerTransactionEntryRequest,
	LedgerTransactionEntryResponse,
	type ListLedgerTransactionEntriesRequest,
	type UpdateLedgerTransactionEntryRequest,
} from "./schema"

const TAGS = ["Ledger Transaction Entries"]
const LedgerTransactionEntriesRoutes: FastifyPluginAsync = server => {
	server.get(
		"/",
		{
			schema: {
				operationId: "listLedgerTransactionEntries",
				tags: TAGS,
				summary: "List Ledger Transaction Entries",
				description: "List Ledger Transaction Entries",
				querystring: PaginationQuery,
				response: {
					200: Type.Array(LedgerTransactionEntryResponse),
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
		},
		async (rq: ListLedgerTransactionEntriesRequest): Promise<LedgerTransactionEntryResponse[]> => {
			const entries = await rq.server.services.ledgerTransactionService.listLedgerTransactionEntries(
				rq.query.offset,
				rq.query.limit
			)
			return entries.map(entry => entry.toResponse())
		}
	)

	server.get(
		"/:ledgerTransactionEntryId",
		{
			schema: {
				operationId: "getLedgerTransactionEntry",
				tags: TAGS,
				summary: "Get Ledger Transaction Entry",
				description: "Get Ledger Transaction Entry",
				params: LedgerTransactionEntryIdParameters,
				response: {
					200: LedgerTransactionEntryResponse,
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
		async (rq: GetLedgerTransactionEntryRequest): Promise<LedgerTransactionEntryResponse> => {
			const ledger = await rq.server.services.ledgerTransactionService.getLedgerTransactionEntry(
				rq.params.ledgerTransactionEntryId
			)
			return ledger.toResponse()
		}
	)

	server.put(
		"/:ledgerTransactionEntryId",
		{
			schema: {
				operationId: "updateLedgerTransactionEntry",
				tags: TAGS,
				summary: "Update Ledger Transaction Entry",
				description: "Update Ledger Transaction Entry",
				params: LedgerTransactionEntryIdParameters,
				body: LedgerTransactionEntryRequest,
				response: {
					200: LedgerTransactionEntryResponse,
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
		async (_rq: UpdateLedgerTransactionEntryRequest): Promise<LedgerTransactionEntryResponse> => {
			// TODO: Implement proper entity creation from request body
			throw new NotImplementedError("Feature not yet implemented")
		}
	)
	return Promise.resolve()
}

export { LedgerTransactionEntriesRoutes }
