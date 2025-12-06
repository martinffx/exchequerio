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
import { LedgerEntity } from "@/services";
import {
	type CreateLedgerRequest,
	type DeleteLedgerRequest,
	type GetLedgerRequest,
	LedgerIdParams as LedgerIdParameters,
	LedgerRequest,
	LedgerResponse,
	type ListLedgersRequest,
	type UpdateLedgerRequest,
} from "./schema";

const TAGS = ["Ledgers"];
const LedgerRoutes: FastifyPluginAsync = async (server): Promise<void> => {
	const { ledgerService } = server.services;
	server.get<{ Querystring: PaginationQuery }>(
		"/",
		{
			schema: {
				operationId: "listLedgers",
				tags: TAGS,
				summary: "List Ledgers",
				description: "List ledgers",
				querystring: PaginationQuery,
				response: {
					200: Type.Array(LedgerResponse),
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:read"]),
		},
		async (rq: ListLedgersRequest): Promise<LedgerResponse[]> => {
			const ledgers = await ledgerService.listLedgers(rq.token.orgId, rq.query.offset, rq.query.limit);
			return ledgers.map(ledger => ledger.toResponse());
		}
	);

	server.get<{ Params: LedgerIdParameters }>(
		"/:ledgerId",
		{
			schema: {
				operationId: "getLedger",
				tags: TAGS,
				summary: "Get ledger",
				description: "Get ledger",
				params: LedgerIdParameters,
				response: {
					200: LedgerResponse,
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
			preHandler: server.hasPermissions(["ledger:read"]),
		},
		async (rq: GetLedgerRequest): Promise<LedgerResponse> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const ledger = await ledgerService.getLedger(orgId, ledgerId);
			return ledger.toResponse();
		}
	);

	server.post<{ Body: LedgerRequest }>(
		"/",
		{
			schema: {
				operationId: "createLedger",
				tags: TAGS,
				summary: "Create ledger",
				description: "Create ledger",
				body: LedgerRequest,
				response: {
					200: LedgerResponse,
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
			preHandler: server.hasPermissions(["ledger:write"]),
		},
		async (rq: CreateLedgerRequest): Promise<LedgerResponse> => {
			const ledger = await ledgerService.createLedger(
				rq.token.orgId,
				LedgerEntity.fromRequest(rq.body, rq.token.orgId)
			);
			return ledger.toResponse();
		}
	);

	server.put<{ Params: LedgerIdParameters; Body: LedgerRequest }>(
		"/:ledgerId",
		{
			schema: {
				operationId: "updateLedger",
				tags: TAGS,
				summary: "Update ledger",
				description: "Update ledger",
				params: LedgerIdParameters,
				body: LedgerRequest,
				response: {
					200: LedgerResponse,
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
			preHandler: server.hasPermissions(["ledger:write"]),
		},
		async (rq: UpdateLedgerRequest): Promise<LedgerResponse> => {
			const org = await ledgerService.updateLedger(
				rq.token.orgId,
				LedgerEntity.fromRequest(rq.body, rq.token.orgId, rq.params.ledgerId)
			);
			return org.toResponse();
		}
	);

	server.delete<{ Params: LedgerIdParameters }>(
		"/:ledgerId",
		{
			schema: {
				operationId: "deleteLedger",
				tags: TAGS,
				summary: "Delete ledger",
				description: "Delete ledger",
				params: LedgerIdParameters,
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
			preHandler: server.hasPermissions(["ledger:delete"]),
		},
		async (rq: DeleteLedgerRequest): Promise<void> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			await ledgerService.deleteLedger(orgId, ledgerId);
		}
	);
};

export { LedgerRoutes };
