import { Type } from "@sinclair/typebox";
import { Effect, Result } from "effect";
import type { FastifyPluginAsync } from "fastify";
import {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
} from "@/lib/errors";
import { IdempotencyHeaders } from "@/lib/IdempotencySchema";
import { parseId } from "@/lib/utils";
import type { LedgerAccountSettlementID, LedgerID } from "@/repo/entities/types";
import {
	LedgerAccountSettlementCollectionParameters as LedgerIdParams,
	LedgerAccountSettlementEntriesRequest,
	LedgerAccountSettlementIdParams,
	LedgerAccountSettlementListQuery as PaginationQuery,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	LedgerAccountSettlementPatchRequest,
	LedgerAccountSettlementEntryResponse,
} from "./LedgerAccountSettlementSchema";
import { LedgerAccountSettlementServiceTag } from "./LedgerAccountSettlementService";

const TAGS = ["Ledger Account Settlements"];
const LedgerAccountSettlementRoutes: FastifyPluginAsync = async server => {
	server.get<{ Params: LedgerIdParams; Querystring: PaginationQuery }>(
		"/",
		{
			schema: {
				operationId: "listLedgerAccountSettlements",
				tags: TAGS,
				summary: "List Ledger Account Settlements",
				description: "List all settlements for a ledger",
				params: LedgerIdParams,
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
			preHandler: server.hasPermissions(["ledger:account:settlement:read"]),
		},
		async rq => {
			const orgId = rq.token.orgId;
			const effect = parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.listLedgerAccountSettlements(orgId, ledgerId, rq.query.offset, rq.query.limit)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: settlements => settlements.map(settlement => settlement.toResponse()),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.get<{
		Params: LedgerIdParams & LedgerAccountSettlementIdParams;
	}>(
		"/:settlementId",
		{
			schema: {
				operationId: "getLedgerAccountSettlement",
				tags: TAGS,
				summary: "Get Ledger Account Settlement",
				description: "Get a single settlement by ID",
				params: Type.Composite([LedgerIdParams, LedgerAccountSettlementIdParams]),
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
			preHandler: server.hasPermissions(["ledger:account:settlement:read"]),
		},
		async rq => {
			const orgId = rq.token.orgId;
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId),
			]).pipe(
				Effect.flatMap(([ledgerId, settlementId]) =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.getLedgerAccountSettlement(orgId, ledgerId, settlementId)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: settlement => settlement.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{
		Params: LedgerIdParams;
		Headers: IdempotencyHeaders;
		Body: LedgerAccountSettlementRequest;
	}>(
		"/",
		{
			schema: {
				operationId: "createLedgerAccountSettlement",
				tags: TAGS,
				summary: "Create Ledger Account Settlement",
				description: "Create a Settlement; defaults to pending status",
				params: LedgerIdParams,
				headers: IdempotencyHeaders,
				body: LedgerAccountSettlementRequest,
				response: {
					201: LedgerAccountSettlementResponse,
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async (rq, reply) => {
			const orgId = rq.token.orgId;
			const effect = parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.createLedgerAccountSettlement(orgId, ledgerId, rq.headers["idempotency-key"], rq.body)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: settlement =>
					reply
						.code(201)
						.header(
							"Location",
							`/api/ledgers/${rq.params.ledgerId}/settlements/${settlement.id.toString()}`
						)
						.send(settlement.toResponse()),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.patch<{
		Params: LedgerIdParams & LedgerAccountSettlementIdParams;
		Headers: IdempotencyHeaders;
		Body: LedgerAccountSettlementPatchRequest;
	}>(
		"/:settlementId",
		{
			schema: {
				operationId: "patchLedgerAccountSettlement",
				tags: TAGS,
				summary: "Update Ledger Account Settlement",
				description: "Update Settlement metadata or lifecycle status",
				params: Type.Composite([LedgerIdParams, LedgerAccountSettlementIdParams]),
				headers: IdempotencyHeaders,
				body: LedgerAccountSettlementPatchRequest,
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
			preHandler: async (rq, reply) => {
				await server.hasPermissions(["ledger:account:settlement:write"])(rq, reply);
				if (rq.body.status === "voided")
					await server.hasPermissions(["ledger:account:settlement:delete"])(rq, reply);
			},
		},
		async rq => {
			const orgId = rq.token.orgId;
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId),
			]).pipe(
				Effect.flatMap(([ledgerId, settlementId]) =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.patchLedgerAccountSettlement(
							orgId,
							ledgerId,
							settlementId,
							rq.headers["idempotency-key"],
							rq.body
						)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: settlement => settlement.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.patch<{
		Params: LedgerIdParams & LedgerAccountSettlementIdParams;
		Headers: IdempotencyHeaders;
		Body: LedgerAccountSettlementEntriesRequest;
	}>(
		"/:settlementId/entries",
		{
			schema: {
				operationId: "addLedgerAccountSettlementEntries",
				tags: TAGS,
				summary: "Add Ledger Account Settlement Entries",
				description:
					"Attach ledger entries to a drafting settlement. Only entries from the settled account that are posted can be attached.",
				params: Type.Composite([LedgerIdParams, LedgerAccountSettlementIdParams]),
				headers: IdempotencyHeaders,
				body: LedgerAccountSettlementEntriesRequest,
				response: {
					204: Type.Null(),
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
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async (rq, reply) => {
			const orgId = rq.token.orgId;
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId),
			]).pipe(
				Effect.flatMap(([ledgerId, settlementId]) =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.addLedgerAccountSettlementEntries(
							orgId,
							ledgerId,
							settlementId,
							rq.headers["idempotency-key"],
							rq.body.entries
						)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: () => reply.code(204).send(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.delete<{
		Params: LedgerIdParams & LedgerAccountSettlementIdParams;
		Headers: IdempotencyHeaders;
		Body: LedgerAccountSettlementEntriesRequest;
	}>(
		"/:settlementId/entries",
		{
			schema: {
				operationId: "removeLedgerAccountSettlementEntries",
				tags: TAGS,
				summary: "Remove Ledger Account Settlement Entries",
				description: "Remove ledger entries from a drafting settlement.",
				params: Type.Composite([LedgerIdParams, LedgerAccountSettlementIdParams]),
				headers: IdempotencyHeaders,
				body: LedgerAccountSettlementEntriesRequest,
				response: {
					204: Type.Null(),
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
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async (rq, reply) => {
			const orgId = rq.token.orgId;
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId),
			]).pipe(
				Effect.flatMap(([ledgerId, settlementId]) =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.removeLedgerAccountSettlementEntries(
							orgId,
							ledgerId,
							settlementId,
							rq.headers["idempotency-key"],
							rq.body.entries
						)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: () => reply.code(204).send(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.get<{
		Params: LedgerIdParams & LedgerAccountSettlementIdParams;
		Querystring: PaginationQuery;
	}>(
		"/:settlementId/entries",
		{
			schema: {
				operationId: "listLedgerAccountSettlementEntries",
				tags: TAGS,
				summary: "List Settlement source Entries",
				description: "List the source Entries belonging to a Settlement",
				params: Type.Composite([LedgerIdParams, LedgerAccountSettlementIdParams]),
				querystring: PaginationQuery,
				response: {
					200: Type.Array(LedgerAccountSettlementEntryResponse),
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			preHandler: server.hasPermissions(["ledger:account:settlement:read"]),
		},
		async rq => {
			const orgId = rq.token.orgId;
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId),
			]).pipe(
				Effect.flatMap(([ledgerId, settlementId]) =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.listLedgerAccountSettlementEntries(
							orgId,
							ledgerId,
							settlementId,
							rq.query.offset,
							rq.query.limit
						)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: entries => entries,
				onFailure: error => {
					throw error;
				},
			});
		}
	);
};

export { LedgerAccountSettlementRoutes };
