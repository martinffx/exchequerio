import { Type } from "@sinclair/typebox";
import { Effect, Result } from "effect";
import type { FastifyPluginAsync } from "fastify";

import { parseAmount } from "@/lib/amounts";
import {
	BadRequestError,
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
	server.addHook("preValidation", async request => {
		const body = request.body;
		if (
			typeof body !== "object" ||
			body === null ||
			!("alertCondition" in body) ||
			!Array.isArray(body.alertCondition)
		)
			return;
		const conditions: unknown[] = body.alertCondition;
		for (const condition of conditions) {
			if (
				typeof condition !== "object" ||
				condition === null ||
				!("field" in condition) ||
				condition.field !== "balance"
			)
				continue;
			if (!("value" in condition) || typeof condition.value !== "string")
				throw new BadRequestError("Balance condition value must be a decimal integer string");
			parseAmount(condition.value);
		}
	});
	server.get<{ Querystring: LedgerAccountBalanceMonitorListQuery }>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:account:balance_monitor:read"])],
			schema: {
				operationId: "listLedgerAccountBalanceMonitors",
				tags,
				summary: "List Ledger Account Balance Monitors",
				description: "List Ledger Account Balance Monitors",
				querystring: LedgerAccountBalanceMonitorListQuerySchema,
				response: { 200: Type.Array(LedgerAccountBalanceMonitorResponse), ...commonErrors },
			},
		},
		async request => {
			const effect = LedgerAccountBalanceMonitorServiceTag.use(service =>
				service.listLedgerAccountBalanceMonitors(request.query.offset, request.query.limit)
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
				service.getLedgerAccountBalanceMonitor(request.params.balanceMonitorId)
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

	server.post<{ Body: LedgerAccountBalanceMonitorRequest }>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:account:balance_monitor:write"])],
			schema: {
				operationId: "createLedgerAccountBalanceMonitor",
				tags,
				summary: "Create Ledger Account Balance Monitor",
				description: "Create Ledger Account Balance Monitor",
				body: LedgerAccountBalanceMonitorRequest,
				response: {
					200: LedgerAccountBalanceMonitorResponse,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = LedgerAccountBalanceMonitorServiceTag.use(service =>
				service.createLedgerAccountBalanceMonitor(request.body)
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
		Body: LedgerAccountBalanceMonitorRequest;
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
				body: LedgerAccountBalanceMonitorRequest,
				response: {
					200: LedgerAccountBalanceMonitorResponse,
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = LedgerAccountBalanceMonitorServiceTag.use(service =>
				service.updateLedgerAccountBalanceMonitor(request.params.balanceMonitorId, request.body)
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
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = LedgerAccountBalanceMonitorServiceTag.use(service =>
				service.deleteLedgerAccountBalanceMonitor(request.params.balanceMonitorId)
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
