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
	UnauthorizedProblem,
} from "@/lib/errors";
import { parseId } from "@/lib/utils";
import type { LedgerID } from "@/repo/entities/types";
import {
	LedgerCreateRequest,
	LedgerIdParameters,
	LedgerListQuery,
	LedgerResponse,
	LedgerUpdateRequest,
	toLedgerResponse,
} from "./LedgerSchema";
import { LedgerServiceTag } from "./LedgerService";

const commonErrors = {
	400: BadRequestProblem,
	401: UnauthorizedProblem,
	403: ForbiddenProblem,
	500: InternalServerProblem,
	503: ServiceUnavailableProblem,
};

const LedgerRoutes: FastifyPluginAsync = async server => {
	server.get<{ Querystring: LedgerListQuery }>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:read"])],
			schema: {
				operationId: "listLedgers",
				tags: ["Ledgers"],
				summary: "List Ledgers",
				querystring: LedgerListQuery,
				response: { 200: Type.Array(LedgerResponse), ...commonErrors },
			},
		},
		async request => {
			const effect = LedgerServiceTag.use(service =>
				service.listLedgers(request.token.orgId, request.query)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: ledgers => ledgers.map(ledger => toLedgerResponse(ledger)),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.get<{ Params: LedgerIdParameters }>(
		"/:ledgerId",
		{
			preHandler: [server.hasPermissions(["ledger:read"])],
			schema: {
				operationId: "getLedger",
				tags: ["Ledgers"],
				summary: "Get a Ledger",
				params: LedgerIdParameters,
				response: { 200: LedgerResponse, 404: NotFoundProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = parseId<"lgr", LedgerID>("lgr", request.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					LedgerServiceTag.use(service => service.getLedger(request.token.orgId, ledgerId))
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: toLedgerResponse,
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{ Body: LedgerCreateRequest }>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:write"])],
			schema: {
				operationId: "createLedger",
				tags: ["Ledgers"],
				summary: "Create a Ledger",
				body: LedgerCreateRequest,
				response: {
					201: LedgerResponse,
					404: NotFoundProblem,
					...commonErrors,
				},
			},
		},
		async (request, reply) => {
			const effect = LedgerServiceTag.use(service =>
				service.createLedger(request.token.orgId, request.body)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: ledger =>
					reply
						.status(201)
						.header("location", `/api/ledgers/${ledger.id.toString()}`)
						.send(toLedgerResponse(ledger)),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.put<{ Params: LedgerIdParameters; Body: LedgerUpdateRequest }>(
		"/:ledgerId",
		{
			preHandler: [server.hasPermissions(["ledger:write"])],
			schema: {
				operationId: "updateLedger",
				tags: ["Ledgers"],
				summary: "Replace a Ledger",
				params: LedgerIdParameters,
				body: LedgerUpdateRequest,
				response: { 200: LedgerResponse, 404: NotFoundProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = parseId<"lgr", LedgerID>("lgr", request.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					LedgerServiceTag.use(service =>
						service.updateLedger(request.token.orgId, ledgerId, request.body)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: toLedgerResponse,
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.delete<{ Params: LedgerIdParameters }>(
		"/:ledgerId",
		{
			preHandler: [server.hasPermissions(["ledger:delete"])],
			schema: {
				operationId: "deleteLedger",
				tags: ["Ledgers"],
				summary: "Delete a Ledger",
				params: LedgerIdParameters,
				response: {
					204: { type: "null" },
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async (request, reply) => {
			const effect = parseId<"lgr", LedgerID>("lgr", request.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					LedgerServiceTag.use(service => service.deleteLedger(request.token.orgId, ledgerId))
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

export { LedgerRoutes };
