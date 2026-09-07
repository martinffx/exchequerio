import { AccountItemParameters } from "../AccountSchema";
import { Type } from "@sinclair/typebox";
import { Effect, Result } from "effect";
import type { FastifyPluginAsync } from "fastify";

import {
	BadRequestProblem,
	ConflictProblem,
	ForbiddenProblem,
	InternalServerProblem,
	NotFoundProblem,
	ServiceUnavailableProblem,
	TooManyRequestsProblem,
	UnauthorizedProblem,
} from "@/lib/errors";

import {
	LedgerAccountBalanceMonitorIdParameters,
	type LedgerAccountBalanceMonitorListQuery,
	LedgerAccountBalanceMonitorListQuerySchema,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorUpdateRequest,
	LedgerAccountBalanceMonitorResponse,
} from "./LedgerAccountBalanceMonitorSchema";
import { LedgerAccountBalanceMonitorServiceTag } from "./LedgerAccountBalanceMonitorService";

const tags = ["Ledger Account Balance Monitors"];
const commonErrors = {
	400: BadRequestProblem,
	401: UnauthorizedProblem,
	403: ForbiddenProblem,
	429: TooManyRequestsProblem,
	500: InternalServerProblem,
	503: ServiceUnavailableProblem,
};

const LedgerAccountBalanceMonitorRoutes: FastifyPluginAsync = async server => {
	server.get<{ Params: AccountItemParameters; Querystring: LedgerAccountBalanceMonitorListQuery }>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:account:balance_monitor:read"])],
			schema: {
				operationId: "listLedgerAccountBalanceMonitors",
				tags,
				summary: "List Ledger Account Balance Monitors",
				description: "List Ledger Account Balance Monitors",
				params: AccountItemParameters,
				querystring: LedgerAccountBalanceMonitorListQuerySchema,
				response: { 200: Type.Array(LedgerAccountBalanceMonitorResponse), ...commonErrors },
			},
		},
		async request => {
			const effect = LedgerAccountBalanceMonitorServiceTag.use(service =>
				service.listLedgerAccountBalanceMonitors(
					{
						organizationId: request.token.orgId.toString(),
						ledgerId: request.params.ledgerId,
						accountId: request.params.accountId,
					},
					request.query.offset,
					request.query.limit
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: monitors => monitors.map(monitor => monitor.toResponse()),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.get<{ Params: LedgerAccountBalanceMonitorIdParameters }>(
		"/:balanceMonitorId",
		{
			preHandler: [server.hasPermissions(["ledger:account:balance_monitor:read"])],
			schema: {
				operationId: "getLedgerAccountBalanceMonitor",
				tags,
				summary: "Get Ledger Account Balance Monitor",
				description: "Get Ledger Account Balance Monitor",
				params: LedgerAccountBalanceMonitorIdParameters,
				response: {
					200: LedgerAccountBalanceMonitorResponse,
					404: NotFoundProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = LedgerAccountBalanceMonitorServiceTag.use(service =>
				service.getLedgerAccountBalanceMonitor(
					{
						organizationId: request.token.orgId.toString(),
						ledgerId: request.params.ledgerId,
						accountId: request.params.accountId,
					},
					request.params.balanceMonitorId
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: monitor => monitor.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{ Params: AccountItemParameters; Body: LedgerAccountBalanceMonitorRequest }>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:account:balance_monitor:write"])],
			schema: {
				operationId: "createLedgerAccountBalanceMonitor",
				tags,
				summary: "Create Ledger Account Balance Monitor",
				description: "Create Ledger Account Balance Monitor",
				params: AccountItemParameters,
				body: LedgerAccountBalanceMonitorRequest,
				response: {
					200: LedgerAccountBalanceMonitorResponse,
					409: ConflictProblem,
					404: NotFoundProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = LedgerAccountBalanceMonitorServiceTag.use(service =>
				service.createLedgerAccountBalanceMonitor(
					{
						organizationId: request.token.orgId.toString(),
						ledgerId: request.params.ledgerId,
						accountId: request.params.accountId,
					},
					request.body
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: monitor => monitor.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.put<{
		Params: LedgerAccountBalanceMonitorIdParameters;
		Body: LedgerAccountBalanceMonitorUpdateRequest;
	}>(
		"/:balanceMonitorId",
		{
			preHandler: [server.hasPermissions(["ledger:account:balance_monitor:write"])],
			schema: {
				operationId: "updateLedgerAccountBalanceMonitor",
				tags,
				summary: "Update Ledger Account Balance Monitor",
				description: "Update Ledger Account Balance Monitor",
				params: LedgerAccountBalanceMonitorIdParameters,
				body: LedgerAccountBalanceMonitorUpdateRequest,
				response: {
					200: LedgerAccountBalanceMonitorResponse,
					409: ConflictProblem,
					404: NotFoundProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = LedgerAccountBalanceMonitorServiceTag.use(service =>
				service.updateLedgerAccountBalanceMonitor(
					{
						organizationId: request.token.orgId.toString(),
						ledgerId: request.params.ledgerId,
						accountId: request.params.accountId,
					},
					request.params.balanceMonitorId,
					request.body
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: monitor => monitor.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.delete<{ Params: LedgerAccountBalanceMonitorIdParameters }>(
		"/:balanceMonitorId",
		{
			preHandler: [server.hasPermissions(["ledger:account:balance_monitor:delete"])],
			schema: {
				operationId: "deleteLedgerAccountBalanceMonitor",
				tags,
				summary: "Delete Ledger Account Balance Monitor",
				description: "Delete Ledger Account Balance Monitor",
				params: LedgerAccountBalanceMonitorIdParameters,
				response: {
					200: {},
					409: ConflictProblem,
					404: NotFoundProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = LedgerAccountBalanceMonitorServiceTag.use(service =>
				service.deleteLedgerAccountBalanceMonitor(
					{
						organizationId: request.token.orgId.toString(),
						ledgerId: request.params.ledgerId,
						accountId: request.params.accountId,
					},
					request.params.balanceMonitorId
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: () => undefined,
				onFailure: error => {
					throw error;
				},
			});
		}
	);
};

export { LedgerAccountBalanceMonitorRoutes };
