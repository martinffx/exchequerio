import { Type } from "@sinclair/typebox";
import { Effect, Result } from "effect";
import type { FastifyPluginAsync } from "fastify";
import { TypeID } from "typeid-js";
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
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const result = await rq.server.runtime.runPromise(
				Effect.result(
					LedgerAccountSettlementServiceTag.use(service =>
						service.listLedgerAccountSettlements(orgId, ledgerId, rq.query.offset, rq.query.limit)
					)
				)
			);
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
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			const result = await rq.server.runtime.runPromise(
				Effect.result(
					LedgerAccountSettlementServiceTag.use(service =>
						service.getLedgerAccountSettlement(orgId, settlementId)
					)
				)
			);
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
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const result = await rq.server.runtime.runPromise(
				Effect.result(
					LedgerAccountSettlementServiceTag.use(service =>
						service.createLedgerAccountSettlement(orgId, ledgerId, rq.body)
					)
				)
			);
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
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			const result = await rq.server.runtime.runPromise(
				Effect.result(
					LedgerAccountSettlementServiceTag.use(service =>
						service.updateLedgerAccountSettlement(orgId, ledgerId, settlementId, rq.body)
					)
				)
			);
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
	}>(
		"/:settlementId",
		{
			schema: {
				operationId: "deleteLedgerAccountSettlement",
				tags: TAGS,
				summary: "Delete Ledger Account Settlement",
				description: "Delete a settlement (only in drafting status)",
				params: Type.Composite([LedgerIdParams, LedgerAccountSettlementIdParams]),
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
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			const result = await rq.server.runtime.runPromise(
				Effect.result(
					LedgerAccountSettlementServiceTag.use(service =>
						service.deleteLedgerAccountSettlement(orgId, settlementId)
					)
				)
			);
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
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			const result = await rq.server.runtime.runPromise(
				Effect.result(
					LedgerAccountSettlementServiceTag.use(service =>
						service.addLedgerAccountSettlementEntries(orgId, settlementId, rq.body.entries)
					)
				)
			);
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
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			const result = await rq.server.runtime.runPromise(
				Effect.result(
					LedgerAccountSettlementServiceTag.use(service =>
						service.removeLedgerAccountSettlementEntries(orgId, settlementId, rq.body.entries)
					)
				)
			);
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
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			const targetStatus = rq.params.status;

			const result = await rq.server.runtime.runPromise(
				Effect.result(
					LedgerAccountSettlementServiceTag.use(service =>
						service.transitionSettlementStatus(orgId, ledgerId, settlementId, targetStatus)
					)
				)
			);
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
