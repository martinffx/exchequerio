import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { TypeID } from "typeid-js";
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
} from "@/routes/schema";
import {
	type CreateLedgerTransactionRequest,
	type DeleteLedgerTransactionRequest,
	type GetLedgerTransactionRequest,
	LedgerIdParams as LedgerIdParameters,
	LedgerIdWithTransactionIdParams,
	LedgerTransactionRequest,
	LedgerTransactionResponse,
	LedgerTransactionUpdateRequest,
	type ListLedgerTransactionsRequest,
	type PostLedgerTransactionRequest,
	type UpdateLedgerTransactionRequest,
} from "./schema";

const TAGS = ["Ledger Transactions"];
const LedgerTransactionRoutes: FastifyPluginAsync = server => {
	server.get<{ Params: LedgerIdParameters; Querystring: PaginationQuery }>(
		"/",
		{
			schema: {
				operationId: "listLedgerTransactions",
				tags: TAGS,
				summary: "List Ledger Transactions",
				description: "List ledger transactions",
				params: LedgerIdParameters,
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:transaction:read"]),
		},
		async (rq: ListLedgerTransactionsRequest): Promise<LedgerTransactionResponse[]> => {
			const transactions = await rq.server.services.ledgerTransactionService.listTransactions(
				rq.token.orgId,
				TypeID.fromString<"lgr">(rq.params.ledgerId),
				rq.query.offset,
				rq.query.limit
			);
			return transactions.map(transaction => transaction.toResponse());
		}
	);

	server.get<{ Params: LedgerIdWithTransactionIdParams }>(
		"/:transactionId",
		{
			schema: {
				operationId: "getLedgerTransaction",
				tags: TAGS,
				summary: "Get Ledger Transaction",
				description: "Get ledger transaction",
				params: LedgerIdWithTransactionIdParams,
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:transaction:read"]),
		},
		async (rq: GetLedgerTransactionRequest): Promise<LedgerTransactionResponse> => {
			const transaction = await rq.server.services.ledgerTransactionService.getLedgerTransaction(
				rq.token.orgId,
				TypeID.fromString<"lgr">(rq.params.ledgerId),
				TypeID.fromString<"ltr">(rq.params.transactionId)
			);
			return transaction.toResponse();
		}
	);

	server.post<{ Params: LedgerIdParameters; Body: LedgerTransactionRequest }>(
		"/",
		{
			schema: {
				operationId: "createLedgerTransaction",
				tags: TAGS,
				summary: "Create Ledger Transaction",
				description: "Create ledger transaction",
				params: LedgerIdParameters,
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:transaction:write"]),
		},
		async (rq: CreateLedgerTransactionRequest): Promise<LedgerTransactionResponse> => {
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const ledgerTransaction = await rq.server.services.ledgerTransactionService.createTransaction(
				rq.token.orgId,
				ledgerId,
				rq.body
			);
			return ledgerTransaction.toResponse();
		}
	);

	server.post<{ Params: LedgerIdWithTransactionIdParams }>(
		"/:transactionId/post",
		{
			schema: {
				operationId: "postLedgerTransaction",
				tags: TAGS,
				summary: "Post Ledger Transaction",
				description: "Post (confirm) a pending ledger transaction",
				params: LedgerIdWithTransactionIdParams,
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:transaction:write"]),
		},
		async (rq: PostLedgerTransactionRequest): Promise<LedgerTransactionResponse> => {
			const transaction = await rq.server.services.ledgerTransactionService.postTransaction(
				rq.token.orgId,
				TypeID.fromString<"lgr">(rq.params.ledgerId),
				TypeID.fromString<"ltr">(rq.params.transactionId)
			);
			return transaction.toResponse();
		}
	);

	server.put<{ Params: LedgerIdWithTransactionIdParams; Body: LedgerTransactionUpdateRequest }>(
		"/:transactionId",
		{
			schema: {
				operationId: "updateLedgerTransaction",
				tags: TAGS,
				summary: "Update Ledger Transaction",
				description:
					"Update a pending ledger transaction's metadata (description, metadata, effectiveAt)",
				params: LedgerIdWithTransactionIdParams,
				body: LedgerTransactionUpdateRequest,
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:transaction:write"]),
		},
		async (rq: UpdateLedgerTransactionRequest): Promise<LedgerTransactionResponse> => {
			const transaction = await rq.server.services.ledgerTransactionService.updateTransaction(
				rq.token.orgId,
				TypeID.fromString<"lgr">(rq.params.ledgerId),
				TypeID.fromString<"ltr">(rq.params.transactionId),
				rq.body
			);
			return transaction.toResponse();
		}
	);

	server.delete<{ Params: LedgerIdWithTransactionIdParams }>(
		"/:transactionId",
		{
			schema: {
				operationId: "deleteLedgerTransaction",
				tags: TAGS,
				summary: "Delete Ledger Transaction",
				description: "Delete ledger transaction",
				params: LedgerIdWithTransactionIdParams,
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:transaction:delete"]),
		},
		async (rq: DeleteLedgerTransactionRequest): Promise<void> => {
			await rq.server.services.ledgerTransactionService.deleteTransaction(
				rq.token.orgId,
				TypeID.fromString<"lgr">(rq.params.ledgerId),
				TypeID.fromString<"ltr">(rq.params.transactionId)
			);
		}
	);
	return Promise.resolve();
};

export { LedgerTransactionRoutes };
