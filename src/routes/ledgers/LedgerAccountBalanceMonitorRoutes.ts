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
	server.get<{ Querystring: PaginationQuery }>(
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:balance_monitor:read"]),
		},
		async (
			rq: ListLedgerAccountBalanceMonitorsRequest
		): Promise<LedgerAccountBalanceMonitorResponse[]> => {
			const monitors =
				await rq.server.services.ledgerAccountBalanceMonitorService.listLedgerAccountBalanceMonitors(
					rq.query.offset,
					rq.query.limit
				);
			return monitors.map(monitor => monitor.toResponse());
		}
	);

	server.get<{ Params: LedgerAccountBalanceMonitorIdParameters }>(
		"/:balanceMonitorId",
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:balance_monitor:read"]),
		},
		async (
			rq: GetLedgerAccountBalanceMonitorRequest
		): Promise<LedgerAccountBalanceMonitorResponse> => {
			const monitor =
				await rq.server.services.ledgerAccountBalanceMonitorService.getLedgerAccountBalanceMonitor(
					rq.params.balanceMonitorId
				);
			return monitor.toResponse();
		}
	);

	server.post<{ Body: LedgerAccountBalanceMonitorRequest }>(
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:balance_monitor:write"]),
		},
		async (
			rq: CreateLedgerAccountBalanceMonitorRequest
		): Promise<LedgerAccountBalanceMonitorResponse> => {
			const ledger =
				await rq.server.services.ledgerAccountBalanceMonitorService.createLedgerAccountBalanceMonitor(
					LedgerAccountBalanceMonitorEntity.fromRequest(rq.body)
				);
			return ledger.toResponse();
		}
	);

	server.put<{
		Params: LedgerAccountBalanceMonitorIdParameters;
		Body: LedgerAccountBalanceMonitorRequest;
	}>(
		"/:balanceMonitorId",
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:balance_monitor:write"]),
		},
		async (
			rq: UpdateLedgerAccountBalanceMonitorRequest
		): Promise<LedgerAccountBalanceMonitorResponse> => {
			const monitor =
				await rq.server.services.ledgerAccountBalanceMonitorService.updateLedgerAccountBalanceMonitor(
					rq.params.balanceMonitorId,
					LedgerAccountBalanceMonitorEntity.fromRequest(rq.body)
				);
			return monitor.toResponse();
		}
	);

	server.delete<{ Params: LedgerAccountBalanceMonitorIdParameters }>(
		"/:balanceMonitorId",
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:balance_monitor:delete"]),
		},
		async (rq: DeleteLedgerAccountBalanceMonitorRequest): Promise<void> => {
			await rq.server.services.ledgerAccountBalanceMonitorService.deleteLedgerAccountBalanceMonitor(
				rq.params.balanceMonitorId
			);
		}
	);
};

export { LedgerAccountBalanceMonitorRoutes };
