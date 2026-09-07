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
import { IdempotencyHeaders } from "@/lib/IdempotencySchema";
import { parseId } from "@/lib/utils";
import type { LedgerAccountID, LedgerAccountStatementID, LedgerID } from "@/lib/ids";
import { toEntryResponse } from "./LedgerAccountStatement";
import {
	LedgerAccountStatementIdParameters,
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
	StatementCollectionParameters,
	StatementEntry,
	StatementListQuery,
	StatementUpdateRequest,
} from "./LedgerAccountStatementSchema";
import { LedgerAccountStatementServiceTag } from "./LedgerAccountStatementService";

const tags = ["Ledger Account Statements"];
const commonErrors = {
	400: BadRequestProblem,
	401: UnauthorizedProblem,
	403: ForbiddenProblem,
	404: NotFoundProblem,
	429: TooManyRequestsProblem,
	500: InternalServerProblem,
	503: ServiceUnavailableProblem,
};
const LedgerAccountStatementRoutes: FastifyPluginAsync = async server => {
	server.get<{ Params: StatementCollectionParameters; Querystring: StatementListQuery }>(
		"/",
		{
			preHandler: server.hasPermissions(["ledger:account:statement:read"]),
			schema: {
				operationId: "listLedgerAccountStatements",
				tags,
				summary: "List Ledger Account Statements",
				description:
					"Lists saved Statement summaries newest first. Entry data is retrieved separately.",
				params: StatementCollectionParameters,
				querystring: StatementListQuery,
				response: { 200: Type.Array(LedgerAccountStatementResponse), ...commonErrors },
			},
		},
		async request => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", request.params.ledgerId),
				parseId<"lat", LedgerAccountID>("lat", request.params.accountId),
			]).pipe(
				Effect.flatMap(([ledgerId, accountId]) =>
					LedgerAccountStatementServiceTag.use(service =>
						service.listLedgerAccountStatements(request.token.orgId, ledgerId, accountId, request.query)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: statements => statements.map(statement => statement.toResponse()),
				onFailure: error => {
					throw error;
				},
			});
		}
	);
	server.get<{ Params: LedgerAccountStatementIdParameters }>(
		"/:statementId",
		{
			preHandler: server.hasPermissions(["ledger:account:statement:read"]),
			schema: {
				operationId: "getLedgerAccountStatement",
				tags,
				summary: "Get Ledger Account Statement",
				description:
					"Returns captured Account context and balances with current Statement annotations. Accounting data never changes after creation.",
				params: LedgerAccountStatementIdParameters,
				response: { 200: LedgerAccountStatementResponse, ...commonErrors },
			},
		},
		async request => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", request.params.ledgerId),
				parseId<"lat", LedgerAccountID>("lat", request.params.accountId),
				parseId<"lst", LedgerAccountStatementID>("lst", request.params.statementId),
			]).pipe(
				Effect.flatMap(([ledgerId, accountId, statementId]) =>
					LedgerAccountStatementServiceTag.use(service =>
						service.getLedgerAccountStatement(request.token.orgId, ledgerId, accountId, statementId)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: statement => statement.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);
	server.get<{ Params: LedgerAccountStatementIdParameters; Querystring: StatementListQuery }>(
		"/:statementId/entries",
		{
			preHandler: server.hasPermissions(["ledger:account:statement:read"]),
			schema: {
				operationId: "getLedgerAccountStatementEntries",
				tags,
				summary: "Get Statement Entries",
				description:
					"Pages copied Account Entries and their Transaction context, ordered by Effective Time then Entry ID. Later Transaction changes do not affect this data.",
				params: LedgerAccountStatementIdParameters,
				querystring: StatementListQuery,
				response: { 200: Type.Array(StatementEntry), ...commonErrors },
			},
		},
		async request => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", request.params.ledgerId),
				parseId<"lat", LedgerAccountID>("lat", request.params.accountId),
				parseId<"lst", LedgerAccountStatementID>("lst", request.params.statementId),
			]).pipe(
				Effect.flatMap(([ledgerId, accountId, statementId]) =>
					LedgerAccountStatementServiceTag.use(service =>
						service.getLedgerAccountStatementEntries(
							request.token.orgId,
							ledgerId,
							accountId,
							statementId,
							request.query
						)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: entries => entries.map(entry => toEntryResponse(entry)),
				onFailure: error => {
					throw error;
				},
			});
		}
	);
	server.post<{
		Params: StatementCollectionParameters;
		Body: LedgerAccountStatementRequest;
		Headers: IdempotencyHeaders;
	}>(
		"/",
		{
			preHandler: server.hasPermissions(["ledger:account:statement:write"]),
			schema: {
				operationId: "createLedgerAccountStatement",
				tags,
				summary: "Create Ledger Account Statement",
				description:
					"Captures current Posted and Pending Entry data for a start-inclusive, end-exclusive Effective Time period, with all three opening and closing balances. Empty and future periods are allowed. Limited to 10,000 period Entries and 16 MiB of serialized snapshot data. Reuse the action key only for retries within the existing 15-minute idempotency window.",
				params: StatementCollectionParameters,
				body: LedgerAccountStatementRequest,
				headers: IdempotencyHeaders,
				response: { 200: LedgerAccountStatementResponse, 409: ConflictProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", request.params.ledgerId),
				parseId<"lat", LedgerAccountID>("lat", request.params.accountId),
			]).pipe(
				Effect.flatMap(([ledgerId, accountId]) =>
					LedgerAccountStatementServiceTag.use(service =>
						service.createLedgerAccountStatement(
							request.token.orgId,
							ledgerId,
							accountId,
							request.headers["idempotency-key"],
							request.body
						)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: statement => statement.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);
	server.put<{ Params: LedgerAccountStatementIdParameters; Body: StatementUpdateRequest }>(
		"/:statementId",
		{
			preHandler: server.hasPermissions(["ledger:account:statement:write"]),
			schema: {
				operationId: "updateLedgerAccountStatement",
				tags,
				summary: "Replace Statement Annotations",
				description:
					"Replaces description and metadata; omitted annotations are cleared. The expected lockVersion must match and is incremented on success. Stale versions return 409. Accounting snapshot data and ledgerAccountVersion remain unchanged.",
				params: LedgerAccountStatementIdParameters,
				body: StatementUpdateRequest,
				response: { 200: LedgerAccountStatementResponse, 409: ConflictProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", request.params.ledgerId),
				parseId<"lat", LedgerAccountID>("lat", request.params.accountId),
				parseId<"lst", LedgerAccountStatementID>("lst", request.params.statementId),
			]).pipe(
				Effect.flatMap(([ledgerId, accountId, statementId]) =>
					LedgerAccountStatementServiceTag.use(service =>
						service.updateLedgerAccountStatement(
							request.token.orgId,
							ledgerId,
							accountId,
							statementId,
							request.body
						)
					)
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: statement => statement.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);
};
export { LedgerAccountStatementRoutes };
