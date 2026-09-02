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
	SettlementStatus,
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
			const effect = parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId).pipe(
				Effect.flatMap(settlementId =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.getLedgerAccountSettlement(orgId, settlementId)
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
				description: "Create a new settlement in drafting status",
				params: LedgerIdParams,
				headers: IdempotencyHeaders,
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
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async rq => {
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
				onSuccess: settlement => settlement.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.put<{
		Params: LedgerIdParams & LedgerAccountSettlementIdParams;
		Headers: IdempotencyHeaders;
		Body: LedgerAccountSettlementRequest;
	}>(
		"/:settlementId",
		{
			schema: {
				operationId: "updateLedgerAccountSettlement",
				tags: TAGS,
				summary: "Update Ledger Account Settlement",
				description: "Update a settlement (only in drafting status)",
				params: Type.Composite([LedgerIdParams, LedgerAccountSettlementIdParams]),
				headers: IdempotencyHeaders,
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
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async rq => {
			const orgId = rq.token.orgId;
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId),
			]).pipe(
				Effect.flatMap(([ledgerId, settlementId]) =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.updateLedgerAccountSettlement(
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

	server.delete<{
		Params: LedgerIdParams & LedgerAccountSettlementIdParams;
		Headers: IdempotencyHeaders;
	}>(
		"/:settlementId",
		{
			schema: {
				operationId: "deleteLedgerAccountSettlement",
				tags: TAGS,
				summary: "Delete Ledger Account Settlement",
				description: "Delete a settlement (only in drafting status)",
				params: Type.Composite([LedgerIdParams, LedgerAccountSettlementIdParams]),
				headers: IdempotencyHeaders,
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
			preHandler: server.hasPermissions(["ledger:account:settlement:delete"]),
		},
		async rq => {
			const orgId = rq.token.orgId;
			const effect = parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId).pipe(
				Effect.flatMap(settlementId =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.deleteLedgerAccountSettlement(orgId, settlementId, rq.headers["idempotency-key"])
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: () => undefined,
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
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async rq => {
			const orgId = rq.token.orgId;
			const effect = parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId).pipe(
				Effect.flatMap(settlementId =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.addLedgerAccountSettlementEntries(
							orgId,
							settlementId,
							rq.headers["idempotency-key"],
							rq.body.entries
						)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: () => undefined,
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
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async rq => {
			const orgId = rq.token.orgId;
			const effect = parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId).pipe(
				Effect.flatMap(settlementId =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.removeLedgerAccountSettlementEntries(
							orgId,
							settlementId,
							rq.headers["idempotency-key"],
							rq.body.entries
						)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: () => undefined,
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{
		Params: LedgerIdParams & LedgerAccountSettlementIdParams & { status: SettlementStatus };
		Headers: IdempotencyHeaders;
	}>(
		"/:settlementId/:status",
		{
			schema: {
				operationId: "transitionLedgerAccountSettlementStatus",
				tags: TAGS,
				summary: "Transition Settlement Status",
				description: "Transition a settlement to a new status following the state machine rules",
				params: Type.Composite([
					LedgerIdParams,
					LedgerAccountSettlementIdParams,
					Type.Object({ status: SettlementStatus }),
				]),
				headers: IdempotencyHeaders,
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
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async rq => {
			const orgId = rq.token.orgId;
			const targetStatus = rq.params.status;
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"las", LedgerAccountSettlementID>("las", rq.params.settlementId),
			]).pipe(
				Effect.flatMap(([ledgerId, settlementId]) =>
					LedgerAccountSettlementServiceTag.use(service =>
						service.transitionSettlementStatus(
							orgId,
							ledgerId,
							settlementId,
							rq.headers["idempotency-key"],
							targetStatus
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
};

export { LedgerAccountSettlementRoutes };
