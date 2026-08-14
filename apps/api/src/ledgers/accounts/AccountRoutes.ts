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
import type { LedgerAccountID, LedgerID } from "@/repo/entities/types";
import {
	AccountCollectionParameters,
	AccountCreateRequest,
	AccountItemParameters,
	AccountListQuery,
	AccountResponse,
	AccountUpdateRequest,
	toAccountResponse,
} from "./AccountSchema";
import { AccountServiceTag } from "./AccountService";

const commonErrors = {
	400: BadRequestProblem,
	401: UnauthorizedProblem,
	403: ForbiddenProblem,
	500: InternalServerProblem,
	503: ServiceUnavailableProblem,
};

const AccountRoutes: FastifyPluginAsync = async server => {
	server.get<{ Params: AccountCollectionParameters; Querystring: AccountListQuery }>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:account:read"])],
			schema: {
				operationId: "listLedgerAccounts",
				tags: ["Ledger Accounts"],
				summary: "List Ledger Accounts",
				params: AccountCollectionParameters,
				querystring: AccountListQuery,
				response: { 200: Type.Array(AccountResponse), 404: NotFoundProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = parseId<"lgr", LedgerID>("lgr", request.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					AccountServiceTag.use(service =>
						service.listAccounts(request.token.orgId, ledgerId, request.query)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: accounts => accounts.map(account => toAccountResponse(account)),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.get<{ Params: AccountItemParameters }>(
		"/:accountId",
		{
			preHandler: [server.hasPermissions(["ledger:account:read"])],
			schema: {
				operationId: "getLedgerAccount",
				tags: ["Ledger Accounts"],
				summary: "Get a Ledger Account",
				params: AccountItemParameters,
				response: { 200: AccountResponse, 404: NotFoundProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", request.params.ledgerId),
				parseId<"lat", LedgerAccountID>("lat", request.params.accountId),
			]).pipe(
				Effect.flatMap(([ledgerId, accountId]) =>
					AccountServiceTag.use(service => service.getAccount(request.token.orgId, ledgerId, accountId))
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: toAccountResponse,
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{ Params: AccountCollectionParameters; Body: AccountCreateRequest }>(
		"/",
		{
			preHandler: [server.hasPermissions(["ledger:account:write"])],
			schema: {
				operationId: "createLedgerAccount",
				tags: ["Ledger Accounts"],
				summary: "Create a Ledger Account",
				params: AccountCollectionParameters,
				body: AccountCreateRequest,
				response: {
					201: AccountResponse,
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async (request, reply) => {
			const effect = parseId<"lgr", LedgerID>("lgr", request.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					AccountServiceTag.use(service =>
						service.createAccount(request.token.orgId, ledgerId, request.body)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: account =>
					reply
						.status(201)
						.header(
							"location",
							`/api/ledgers/${account.ledgerId.toString()}/accounts/${account.id.toString()}`
						)
						.send(toAccountResponse(account)),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.put<{ Params: AccountItemParameters; Body: AccountUpdateRequest }>(
		"/:accountId",
		{
			preHandler: [server.hasPermissions(["ledger:account:write"])],
			schema: {
				operationId: "updateLedgerAccount",
				tags: ["Ledger Accounts"],
				summary: "Replace a Ledger Account",
				params: AccountItemParameters,
				body: AccountUpdateRequest,
				response: {
					200: AccountResponse,
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async request => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", request.params.ledgerId),
				parseId<"lat", LedgerAccountID>("lat", request.params.accountId),
			]).pipe(
				Effect.flatMap(([ledgerId, accountId]) =>
					AccountServiceTag.use(service =>
						service.updateAccount(request.token.orgId, ledgerId, accountId, request.body)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: toAccountResponse,
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.delete<{ Params: AccountItemParameters }>(
		"/:accountId",
		{
			preHandler: [server.hasPermissions(["ledger:account:delete"])],
			schema: {
				operationId: "deleteLedgerAccount",
				tags: ["Ledger Accounts"],
				summary: "Delete a Ledger Account",
				params: AccountItemParameters,
				response: {
					204: { type: "null" },
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async (request, reply) => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", request.params.ledgerId),
				parseId<"lat", LedgerAccountID>("lat", request.params.accountId),
			]).pipe(
				Effect.flatMap(([ledgerId, accountId]) =>
					AccountServiceTag.use(service =>
						service.deleteAccount(request.token.orgId, ledgerId, accountId)
					)
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

export { AccountRoutes };
