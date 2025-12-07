import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { TypeID } from "typeid-js";
import { LedgerAccountSettlementEntity } from "@/services";
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
	type AddLedgerAccountSettlementEntryRequest,
	type CreateLedgerAccountSettlementRequest,
	type DeleteLedgerAccountSettlementRequest,
	type GetLedgerAccountSettlementRequest,
	LedgerAccountSettlementEntriesRequest,
	LedgerAccountSettlementIdParams,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	LedgerIdParams,
	type ListLedgerAccountSettlementsRequest,
	type RemoveLedgerAccountSettlementEntryRequest,
	SettlementStatus,
	type TransitionLedgerAccountSettlementStatusRequest,
	type UpdateLedgerAccountSettlementRequest,
} from "./schema";

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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:settlement:read"]),
		},
		async (rq: ListLedgerAccountSettlementsRequest): Promise<LedgerAccountSettlementResponse[]> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const settlements =
				await rq.server.services.ledgerAccountSettlementService.listLedgerAccountSettlements(
					orgId,
					ledgerId,
					rq.query.offset,
					rq.query.limit
				);
			return settlements.map(settlement => settlement.toResponse());
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:settlement:read"]),
		},
		async (rq: GetLedgerAccountSettlementRequest): Promise<LedgerAccountSettlementResponse> => {
			const orgId = rq.token.orgId;
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			const settlement =
				await rq.server.services.ledgerAccountSettlementService.getLedgerAccountSettlement(
					orgId,
					settlementId
				);
			return settlement.toResponse();
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async (rq: CreateLedgerAccountSettlementRequest): Promise<LedgerAccountSettlementResponse> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);

			// Get the ledger to retrieve currency information
			const ledger = await rq.server.services.ledgerService.getLedger(orgId, ledgerId);

			// Determine normal balance from settled account (debit or credit)
			const settledAccountId = TypeID.fromString<"lat">(rq.body.settledAccountId);
			const settledAccount = await rq.server.services.ledgerAccountService.getLedgerAccount(
				orgId,
				ledgerId,
				settledAccountId
			);

			const settlement = LedgerAccountSettlementEntity.fromRequest(
				rq.body,
				orgId,
				ledger.currency,
				ledger.currencyExponent,
				settledAccount.normalBalance
			);

			const created =
				await rq.server.services.ledgerAccountSettlementService.createLedgerAccountSettlement(
					settlement
				);
			return created.toResponse();
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async (rq: UpdateLedgerAccountSettlementRequest): Promise<LedgerAccountSettlementResponse> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);

			// Get the ledger to retrieve currency information
			const ledger = await rq.server.services.ledgerService.getLedger(orgId, ledgerId);

			// Determine normal balance from settled account
			const settledAccountId = TypeID.fromString<"lat">(rq.body.settledAccountId);
			const settledAccount = await rq.server.services.ledgerAccountService.getLedgerAccount(
				orgId,
				ledgerId,
				settledAccountId
			);

			const settlement = LedgerAccountSettlementEntity.fromRequest(
				rq.body,
				orgId,
				ledger.currency,
				ledger.currencyExponent,
				settledAccount.normalBalance,
				settlementId.toString()
			);

			const updated =
				await rq.server.services.ledgerAccountSettlementService.updateLedgerAccountSettlement(
					orgId,
					settlementId,
					settlement
				);
			return updated.toResponse();
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:settlement:delete"]),
		},
		async (rq: DeleteLedgerAccountSettlementRequest): Promise<void> => {
			const orgId = rq.token.orgId;
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			await rq.server.services.ledgerAccountSettlementService.deleteLedgerAccountSettlement(
				orgId,
				settlementId
			);
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async (rq: AddLedgerAccountSettlementEntryRequest): Promise<void> => {
			const orgId = rq.token.orgId;
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			await rq.server.services.ledgerAccountSettlementService.addLedgerAccountSettlementEntries(
				orgId,
				settlementId,
				rq.body.entries
			);
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async (rq: RemoveLedgerAccountSettlementEntryRequest): Promise<void> => {
			const orgId = rq.token.orgId;
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			await rq.server.services.ledgerAccountSettlementService.removeLedgerAccountSettlementEntries(
				orgId,
				settlementId,
				rq.body.entries
			);
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
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:settlement:write"]),
		},
		async (
			rq: TransitionLedgerAccountSettlementStatusRequest
		): Promise<LedgerAccountSettlementResponse> => {
			const orgId = rq.token.orgId;
			const settlementId = TypeID.fromString<"las">(rq.params.settlementId);
			const targetStatus = rq.params.status;

			const settlement =
				await rq.server.services.ledgerAccountSettlementService.transitionSettlementStatus(
					orgId,
					settlementId,
					targetStatus
				);
			return settlement.toResponse();
		}
	);
};

export { LedgerAccountSettlementRoutes };
