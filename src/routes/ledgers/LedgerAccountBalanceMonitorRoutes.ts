import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { LedgerAccountBalanceMonitorEntity } from "@/services";
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
import {
	type CreateLedgerAccountBalanceMonitorRequest,
	type DeleteLedgerAccountBalanceMonitorRequest,
	type GetLedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorIdParams as LedgerAccountBalanceMonitorIdParameters,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
	type ListLedgerAccountBalanceMonitorsRequest,
	type UpdateLedgerAccountBalanceMonitorRequest,
} from "./schema";

const TAGS = ["Ledger Account Balance Monitors"];
const LedgerAccountBalanceMonitorRoutes: FastifyPluginAsync = async server => {
	server.get(
		"/",
		{
			schema: {
				operationId: "listLedgerAccountBalanceMonitors",
				tags: TAGS,
				summary: "List Ledger Account Balance Monitors",
				description: "List Ledger Account Balance Monitors",
				querystring: PaginationQuery,
				response: {
					200: Type.Array(LedgerAccountBalanceMonitorResponse),
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
			rq: ListLedgerAccountBalanceMonitorsRequest
		): Promise<LedgerAccountBalanceMonitorResponse[]> => {
			const monitors = await rq.server.services.ledgerAccountService.listLedgerAccountBalanceMonitors(
				rq.query.offset,
				rq.query.limit
			);
			return monitors.map(monitor => monitor.toResponse());
		}
	);

	server.get(
		"/:ledgerAccountBalanceMonitorId",
		{
			schema: {
				operationId: "getLedgerAccountBalanceMonitor",
				tags: TAGS,
				summary: "Get Ledger Account Balance Monitor",
				description: "Get Ledger Account Balance Monitor",
				params: LedgerAccountBalanceMonitorIdParameters,
				response: {
					200: LedgerAccountBalanceMonitorResponse,
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
			rq: GetLedgerAccountBalanceMonitorRequest
		): Promise<LedgerAccountBalanceMonitorResponse> => {
			const monitor = await rq.server.services.ledgerAccountService.getLedgerAccountBalanceMonitor(
				rq.params.ledgerAccountBalanceMonitorId
			);
			return monitor.toResponse();
		}
	);

	server.post(
		"/",
		{
			schema: {
				operationId: "createLedgerAccountBalanceMonitor",
				tags: TAGS,
				summary: "Create Ledger Account Balance Monitor",
				description: "Create Ledger Account Balance Monitor",
				body: LedgerAccountBalanceMonitorRequest,
				response: {
					200: LedgerAccountBalanceMonitorResponse,
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
			rq: CreateLedgerAccountBalanceMonitorRequest
		): Promise<LedgerAccountBalanceMonitorResponse> => {
			const ledger = await rq.server.services.ledgerAccountService.createLedgerAccountBalanceMonitor(
				LedgerAccountBalanceMonitorEntity.fromRequest(rq.body)
			);
			return ledger.toResponse();
		}
	);

	server.put(
		"/:ledgerAccountBalanceMonitorId",
		{
			schema: {
				operationId: "updateLedgerAccountBalanceMonitor",
				tags: TAGS,
				summary: "Update Ledger Account Balance Monitor",
				description: "Update Ledger Account Balance Monitor",
				params: LedgerAccountBalanceMonitorIdParameters,
				body: LedgerAccountBalanceMonitorRequest,
				response: {
					200: LedgerAccountBalanceMonitorResponse,
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
			rq: UpdateLedgerAccountBalanceMonitorRequest
		): Promise<LedgerAccountBalanceMonitorResponse> => {
			const monitor = await rq.server.services.ledgerAccountService.updateLedgerAccountBalanceMonitor(
				rq.params.ledgerAccountBalanceMonitorId,
				LedgerAccountBalanceMonitorEntity.fromRequest(rq.body)
			);
			return monitor.toResponse();
		}
	);

	server.delete(
		"/:ledgerAccountBalanceMonitorId",
		{
			schema: {
				operationId: "deleteLedgerAccountBalanceMonitor",
				tags: TAGS,
				summary: "Delete Ledger Account Balance Monitor",
				description: "Delete Ledger Account Balance Monitor",
				params: LedgerAccountBalanceMonitorIdParameters,
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
		async (rq: DeleteLedgerAccountBalanceMonitorRequest): Promise<void> => {
			await rq.server.services.ledgerAccountService.deleteLedgerAccountBalanceMonitor(
				rq.params.ledgerAccountBalanceMonitorId
			);
		}
	);
};

export { LedgerAccountBalanceMonitorRoutes };
