import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import {
	type CreateLedgerRequest,
	type DeleteLedgerRequest,
	type GetLedgerRequest,
	LedgerIdParams,
	LedgerRequest,
	LedgerResponse,
	type ListLedgersRequest,
	type UpdateLedgerRequest,
} from "./schema";
import {
	PaginationQuery,
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
} from "@/routes/schema";
import { LedgerEntity } from "@/services";
import { TypeID } from "typeid-js";

const TAGS = ["Ledgers"];
const LedgerRoutes: FastifyPluginAsync = async (server) => {
	server.get(
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
		},
		async (rq: ListLedgersRequest): Promise<LedgerResponse[]> => {
			const ledgers = await rq.server.services.ledgerService.listLedgers(
				rq.token.orgId,
				rq.query.offset,
				rq.query.limit,
			);
			return ledgers.map((ledger) => ledger.toResponse());
		},
	);

	server.get(
		"/:ledgerId",
		{
			schema: {
				operationId: "getLedger",
				tags: TAGS,
				summary: "Get ledger",
				description: "Get ledger",
				params: LedgerIdParams,
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
		},
		async (rq: GetLedgerRequest): Promise<LedgerResponse> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const ledger = await rq.server.services.ledgerService.getLedger(
				orgId,
				ledgerId,
			);
			return ledger.toResponse();
		},
	);

	server.post(
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
		},
		async (rq: CreateLedgerRequest): Promise<LedgerResponse> => {
			const ledger = await rq.server.services.ledgerService.createLedger(
				rq.token.orgId,
				LedgerEntity.fromRequest(rq.body, rq.token.orgId),
			);
			return ledger.toResponse();
		},
	);

	server.put(
		"/:ledgerId",
		{
			schema: {
				operationId: "updateLedger",
				tags: TAGS,
				summary: "Update ledger",
				description: "Update ledger",
				params: LedgerIdParams,
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
		},
		async (rq: UpdateLedgerRequest): Promise<LedgerResponse> => {
			const org = await rq.server.services.ledgerService.updateLedger(
				rq.token.orgId,
				LedgerEntity.fromRequest(rq.body, rq.token.orgId, rq.params.ledgerId),
			);
			return org.toResponse();
		},
	);

	server.delete(
		"/:ledgerId",
		{
			schema: {
				operationId: "deleteLedger",
				tags: TAGS,
				summary: "Delete ledger",
				description: "Delete ledger",
				params: LedgerIdParams,
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
		async (rq: DeleteLedgerRequest): Promise<void> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			await rq.server.services.ledgerService.deleteLedger(orgId, ledgerId);
		},
	);
};

export { LedgerRoutes };
