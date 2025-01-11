import type { FastifyPluginAsync } from "fastify";
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
} from "../schema";
import { Type } from "@sinclair/typebox";
import {
	type AddLedgerAccountSettlementEntryRequest,
	type CreateLedgerAccountSettlementRequest,
	type DeleteLedgerAccountSettlementRequest,
	type GetLedgerAccountSettlementRequest,
	LedgerAccountSettlementEntriesRequest,
	LedgerAccountSettlementIdParams,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	type ListLedgerAccountSettlementsRequest,
	type RemoveLedgerAccountSettlementEntryRequest,
	type UpdateLedgerAccountSettlementRequest,
} from "./schema";
import { LedgerAccountSettlementEntity } from "@/services";

const TAGS = ["Ledger Account Settlements"];
const LedgerAccountSettlementRoutes: FastifyPluginAsync = async (server) => {
	server.get(
		"/",
		{
			schema: {
				operationId: "listLedgerAccountSettlements",
				tags: TAGS,
				summary: "List Ledger Account Settlements",
				description: "List Ledger Account Settlements",
				querystring: PaginationQuery,
				response: {
					200: Type.Array(LedgerAccountSettlementResponse),
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
		},
		async (
			rq: ListLedgerAccountSettlementsRequest,
		): Promise<LedgerAccountSettlementResponse[]> => {
			const settlements =
				await rq.server.services.ledgerAccountService.listLedgerAccountSettlements(
					rq.query.offset,
					rq.query.limit,
				);
			return settlements.map((settlement) => settlement.toResponse());
		},
	);

	server.get(
		"/:ledgerAccountSettlementId",
		{
			schema: {
				operationId: "getLedgerAccountSettlement",
				tags: TAGS,
				summary: "Get Ledger Account Settlement",
				description: "Get Ledger Account Settlement",
				params: LedgerAccountSettlementIdParams,
				response: {
					200: LedgerAccountSettlementResponse,
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
		async (
			rq: GetLedgerAccountSettlementRequest,
		): Promise<LedgerAccountSettlementResponse> => {
			const category =
				await rq.server.services.ledgerAccountService.getLedgerAccountSettlement(
					rq.params.ledgerAccountSettlementId,
				);
			return category.toResponse();
		},
	);

	server.post(
		"/",
		{
			schema: {
				operationId: "createLedgerAccountSettlement",
				tags: TAGS,
				summary: "Create Ledger Account Settlement",
				description: "Create Ledger Account Settlement",
				body: LedgerAccountSettlementRequest,
				response: {
					200: LedgerAccountSettlementResponse,
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
		async (
			rq: CreateLedgerAccountSettlementRequest,
		): Promise<LedgerAccountSettlementResponse> => {
			const category =
				await rq.server.services.ledgerAccountService.createLedgerAccountSettlement(
					LedgerAccountSettlementEntity.fromRequest(rq.body),
				);
			return category.toResponse();
		},
	);

	server.put(
		"/:ledgerAccountSettlementId",
		{
			schema: {
				operationId: "updateLedgerAccountSettlement",
				tags: TAGS,
				summary: "Update Ledger Account Settlement",
				description: "Update Ledger Account Settlement",
				params: LedgerAccountSettlementIdParams,
				body: LedgerAccountSettlementRequest,
				response: {
					200: LedgerAccountSettlementResponse,
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
		async (
			rq: UpdateLedgerAccountSettlementRequest,
		): Promise<LedgerAccountSettlementResponse> => {
			const org =
				await rq.server.services.ledgerAccountService.updateLedgerAccountSettlement(
					rq.params.ledgerAccountSettlementId,
					LedgerAccountSettlementEntity.fromRequest(rq.body),
				);
			return org.toResponse();
		},
	);

	server.delete(
		"/:ledgerAccountSettlementId",
		{
			schema: {
				operationId: "deleteLedgerAccountSettlement",
				tags: TAGS,
				summary: "Delete Ledger Account Settlement",
				description: "Delete Ledger Account Settlement",
				params: LedgerAccountSettlementIdParams,
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
		async (rq: DeleteLedgerAccountSettlementRequest): Promise<void> => {
			await rq.server.services.ledgerAccountService.deleteLedgerAccountSettlement(
				rq.params.ledgerAccountSettlementId,
			);
		},
	);

	server.patch(
		"/:ledgerAccountSettlementId/entries",
		{
			schema: {
				operationId: "addLedgerAccountSettlementEntries",
				tags: TAGS,
				summary: "Add Ledger Account Settlement Entries",
				description:
					"This API allows attaching Ledger Entries to a drafting Ledger Account Settlement.",
				params: LedgerAccountSettlementIdParams,
				body: LedgerAccountSettlementEntriesRequest,
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
		async (rq: AddLedgerAccountSettlementEntryRequest): Promise<void> => {
			await rq.server.services.ledgerAccountService.addLedgerAccountSettlementEntries(
				rq.params.ledgerAccountSettlementId,
				rq.body.entries,
			);
		},
	);

	server.delete(
		"/:ledgerAccountSettlementId/entries",
		{
			schema: {
				operationId: "removeLedgerAccountSettlementEntries",
				tags: TAGS,
				summary: "Remove Ledger Account Settlement Entries",
				description:
					"This API allows removing Ledger Entries from a drafting Ledger Account Settlement.",
				params: LedgerAccountSettlementIdParams,
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
		async (rq: RemoveLedgerAccountSettlementEntryRequest): Promise<void> => {
			await rq.server.services.ledgerAccountService.removeLedgerAccountSettlementEntries(
				rq.params.ledgerAccountSettlementId,
				rq.body.entries,
			);
		},
	);
};

export { LedgerAccountSettlementRoutes };
