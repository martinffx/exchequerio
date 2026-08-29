import { Effect, Result } from "effect";
import type { FastifyPluginAsync } from "fastify";

import {
	BadRequestProblem,
	ConflictProblem,
	ForbiddenProblem,
	InternalServerProblem,
	NotFoundProblem,
	ServiceUnavailableProblem,
	UnauthorizedProblem,
} from "@/lib/errors";
import { parseId } from "@/lib/utils";
import type { LedgerID, LedgerTransactionID } from "@/repo/entities/types";

import {
	TransactionCollectionParameters,
	TransactionCreateHeaders,
	TransactionCreateRequest,
	TransactionDeleteResponse,
	TransactionItemParameters,
	TransactionListQuery,
	TransactionListResponse,
	TransactionUpdateRequest,
	TransactionResponse,
} from "./LedgerTransactionSchema";
import { TransactionServiceTag } from "./LedgerTransactionService";

const commonErrors = {
	400: BadRequestProblem,
	401: UnauthorizedProblem,
	403: ForbiddenProblem,
	500: InternalServerProblem,
	503: ServiceUnavailableProblem,
};

const parseItemIds = (ledgerId: string, transactionId: string) =>
	Effect.all([
		parseId<"lgr", LedgerID>("lgr", ledgerId),
		parseId<"ltr", LedgerTransactionID>("ltr", transactionId),
	]);

const TransactionRoutes: FastifyPluginAsync = async server => {
	server.get<{ Params: TransactionCollectionParameters; Querystring: TransactionListQuery }>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:transaction:read"])],
			schema: {
				operationId: "listLedgerTransactions",
				tags: ["Ledger Transactions"],
				summary: "List Ledger Transactions",
				params: TransactionCollectionParameters,
				querystring: TransactionListQuery,
				response: { 200: TransactionListResponse, 404: NotFoundProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = parseId<"lgr", LedgerID>("lgr", request.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					TransactionServiceTag.use(service =>
						service.listTransactions(request.token.orgId, ledgerId, request.query)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: transactions => transactions.map(transaction => transaction.toListItemResponse()),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.get<{ Params: TransactionItemParameters }>(
		"/:transactionId",
		{
			preHandler: [server.hasPermissions(["ledger:transaction:read"])],
			schema: {
				operationId: "getLedgerTransaction",
				tags: ["Ledger Transactions"],
				summary: "Get a Ledger Transaction",
				params: TransactionItemParameters,
				response: { 200: TransactionResponse, 404: NotFoundProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = parseItemIds(request.params.ledgerId, request.params.transactionId).pipe(
				Effect.flatMap(([ledgerId, transactionId]) =>
					TransactionServiceTag.use(service =>
						service.getTransaction(request.token.orgId, ledgerId, transactionId)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: transaction => transaction.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{
		Params: TransactionCollectionParameters;
		Headers: TransactionCreateHeaders;
		Body: TransactionCreateRequest;
	}>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:transaction:write"])],
			schema: {
				operationId: "createLedgerTransaction",
				tags: ["Ledger Transactions"],
				summary: "Create a Ledger Transaction",
				params: TransactionCollectionParameters,
				headers: TransactionCreateHeaders,
				body: TransactionCreateRequest,
				response: {
					201: TransactionResponse,
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async (request, reply) => {
			const effect = parseId<"lgr", LedgerID>("lgr", request.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					TransactionServiceTag.use(service =>
						service.createTransaction(
							request.token.orgId,
							ledgerId,
							request.headers["idempotency-key"],
							request.body
						)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: transaction =>
					reply
						.status(201)
						.header(
							"location",
							`/api/ledgers/${transaction.ledgerId.toString()}/transactions/${transaction.id.toString()}`
						)
						.send(transaction.toResponse()),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.put<{ Params: TransactionItemParameters; Body: TransactionUpdateRequest }>(
		"/:transactionId",
		{
			preHandler: [server.hasPermissions(["ledger:transaction:write"])],
			schema: {
				operationId: "updateLedgerTransaction",
				tags: ["Ledger Transactions"],
				summary: "Update a Ledger Transaction",
				params: TransactionItemParameters,
				body: TransactionUpdateRequest,
				response: {
					200: TransactionResponse,
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = parseItemIds(request.params.ledgerId, request.params.transactionId).pipe(
				Effect.flatMap(([ledgerId, transactionId]) =>
					TransactionServiceTag.use(service =>
						service.updateTransaction(request.token.orgId, ledgerId, transactionId, request.body)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: transaction => transaction.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{ Params: TransactionItemParameters }>(
		"/:transactionId/post",
		{
			preHandler: [server.hasPermissions(["ledger:transaction:write"])],
			schema: {
				operationId: "postLedgerTransaction",
				tags: ["Ledger Transactions"],
				summary: "Post a Ledger Transaction",
				params: TransactionItemParameters,
				response: {
					200: TransactionResponse,
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = parseItemIds(request.params.ledgerId, request.params.transactionId).pipe(
				Effect.flatMap(([ledgerId, transactionId]) =>
					TransactionServiceTag.use(service =>
						service.postTransaction(request.token.orgId, ledgerId, transactionId)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: transaction => transaction.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.delete<{ Params: TransactionItemParameters }>(
		"/:transactionId",
		{
			preHandler: [server.hasPermissions(["ledger:transaction:delete"])],
			schema: {
				operationId: "voidLedgerTransaction",
				tags: ["Ledger Transactions"],
				summary: "Void a Ledger Transaction",
				params: TransactionItemParameters,
				response: {
					204: TransactionDeleteResponse,
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async (request, reply) => {
			const effect = parseItemIds(request.params.ledgerId, request.params.transactionId).pipe(
				Effect.flatMap(([ledgerId, transactionId]) =>
					TransactionServiceTag.use(service =>
						service.voidTransaction(request.token.orgId, ledgerId, transactionId)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: () => reply.status(204).send(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);
};

export { TransactionRoutes };
