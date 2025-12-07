import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { TypeID } from "typeid-js";
import { LedgerAccountEntity } from "@/repo/entities";
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
} from "@/routes/schema";
import {
	type CreateLedgerAccountRequest,
	type DeleteLedgerAccountRequest,
	type GetLedgerAccountRequest,
	LedgerAccountRequest,
	LedgerAccountResponse,
	LedgerIdParams as LedgerIdParameters,
	LedgerIdWithAccountIdParams,
	type ListLedgerAccountsRequest,
	type UpdateLedgerAccountRequest,
} from "./schema";

const TAGS = ["Ledger Accounts"];
const LedgerAccountRoutes: FastifyPluginAsync = async (server): Promise<void> => {
	const { ledgerService, ledgerAccountService } = server.services;
	server.get<{ Params: LedgerIdParameters; Querystring: PaginationQuery }>(
		"/",
		{
			schema: {
				operationId: "listLedgerAccounts",
				tags: TAGS,
				summary: "List Ledger Accounts",
				description: "List ledger accounts",
				params: LedgerIdParameters,
				querystring: PaginationQuery,
				response: {
					200: Type.Array(LedgerAccountResponse),
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:read"]),
		},
		async (rq: ListLedgerAccountsRequest): Promise<LedgerAccountResponse[]> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);

			// Fetch ledger to get currency info
			const ledger = await ledgerService.getLedger(orgId, ledgerId);

			const accounts = await ledgerAccountService.listLedgerAccounts(
				orgId,
				ledgerId,
				rq.query.offset,
				rq.query.limit
			);
			return accounts.map(account => account.toResponse(ledger.currency, ledger.currencyExponent));
		}
	);

	server.get<{ Params: LedgerIdWithAccountIdParams }>(
		"/:ledgerAccountId",
		{
			schema: {
				operationId: "getLedgerAccount",
				tags: TAGS,
				summary: "Get Ledger Account",
				description: "Get ledger account",
				params: LedgerIdWithAccountIdParams,
				response: {
					200: LedgerAccountResponse,
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
			preHandler: server.hasPermissions(["ledger:account:read"]),
		},
		async (rq: GetLedgerAccountRequest): Promise<LedgerAccountResponse> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const accountId = TypeID.fromString<"lat">(rq.params.ledgerAccountId);

			// Get ledger for currency info
			const ledgerEntity = await ledgerService.getLedger(orgId, ledgerId);

			const account = await ledgerAccountService.getLedgerAccount(orgId, ledgerId, accountId);
			return account.toResponse(ledgerEntity.currency, ledgerEntity.currencyExponent);
		}
	);

	server.post<{ Params: LedgerIdParameters; Body: LedgerAccountRequest }>(
		"/",
		{
			schema: {
				operationId: "createLedgerAccount",
				tags: TAGS,
				summary: "Create Ledger Account",
				description: "Create ledger account",
				params: LedgerIdParameters,
				body: LedgerAccountRequest,
				response: {
					200: LedgerAccountResponse,
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
			preHandler: server.hasPermissions(["ledger:account:write"]),
		},
		async (rq: CreateLedgerAccountRequest): Promise<LedgerAccountResponse> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);

			// Get ledger for currency info
			const ledgerEntity = await ledgerService.getLedger(orgId, ledgerId);

			const entity = LedgerAccountEntity.fromRequest(rq.body, orgId, ledgerId, "debit");
			const account = await ledgerAccountService.createLedgerAccount(entity);
			return account.toResponse(ledgerEntity.currency, ledgerEntity.currencyExponent);
		}
	);

	server.put<{
		Params: LedgerIdWithAccountIdParams;
		Body: LedgerAccountRequest;
	}>(
		"/:ledgerAccountId",
		{
			schema: {
				operationId: "updateLedgerAccount",
				tags: TAGS,
				summary: "Update Ledger Account",
				description: "Update ledger account",
				params: LedgerIdWithAccountIdParams,
				body: LedgerAccountRequest,
				response: {
					200: LedgerAccountResponse,
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
			preHandler: server.hasPermissions(["ledger:account:write"]),
		},
		async (rq: UpdateLedgerAccountRequest): Promise<LedgerAccountResponse> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const accountId = TypeID.fromString<"lat">(rq.params.ledgerAccountId);

			// Get ledger for currency info
			const ledgerEntity = await ledgerService.getLedger(orgId, ledgerId);

			// Fetch existing account to preserve normalBalance
			const existingAccount = await ledgerAccountService.getLedgerAccount(orgId, ledgerId, accountId);

			const entity = LedgerAccountEntity.fromRequest(
				rq.body,
				orgId,
				ledgerId,
				existingAccount.normalBalance,
				rq.params.ledgerAccountId
			);
			const account = await ledgerAccountService.updateLedgerAccount(entity);
			return account.toResponse(ledgerEntity.currency, ledgerEntity.currencyExponent);
		}
	);

	server.delete<{ Params: LedgerIdWithAccountIdParams }>(
		"/:ledgerAccountId",
		{
			schema: {
				operationId: "deleteLedgerAccount",
				tags: TAGS,
				summary: "Delete Ledger Account",
				description: "Delete ledger account",
				params: LedgerIdWithAccountIdParams,
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
			preHandler: server.hasPermissions(["ledger:account:delete"]),
		},
		async (rq: DeleteLedgerAccountRequest): Promise<void> => {
			const orgId = rq.token.orgId;
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const accountId = TypeID.fromString<"lat">(rq.params.ledgerAccountId);

			await ledgerAccountService.deleteLedgerAccount(orgId, ledgerId, accountId);
		}
	);
};

export { LedgerAccountRoutes };
