import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { CurrentToken, requirePermissions } from "@/auth";
import type { LedgerAccountID, LedgerAccountStatementID } from "@/lib/ids";
import { parseId, parseLedgerId, runToCompletion } from "@/lib/utils";
import { LedgerAccountStatementServiceTag } from "./LedgerAccountStatementService";

const parseAccountId = (accountId: string) => parseId<"lat", LedgerAccountID>("lat", accountId);
const parseStatementId = (statementId: string) =>
	parseId<"lst", LedgerAccountStatementID>("lst", statementId);

const LedgerAccountStatementRoutes = HttpApiBuilder.group(LedgerApi, "statements", handlers =>
	Effect.gen(function* () {
		const service = yield* LedgerAccountStatementServiceTag;
		return handlers
			.handle(
				"list",
				({ params, query }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:account:statement:read"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const accountId = yield* parseAccountId(params.accountId);
						const statements = yield* service.listLedgerAccountStatements(
							token.orgId,
							ledgerId,
							accountId,
							query
						);
						return statements.map(statement => statement.toResponse());
					}),
				runToCompletion
			)
			.handle(
				"get",
				({ params }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:account:statement:read"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const accountId = yield* parseAccountId(params.accountId);
						const statementId = yield* parseStatementId(params.statementId);
						const statement = yield* service.getLedgerAccountStatement(
							token.orgId,
							ledgerId,
							accountId,
							statementId
						);
						return statement.toResponse();
					}),
				runToCompletion
			)
			.handle(
				"entries",
				({ params, query }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:account:statement:read"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const accountId = yield* parseAccountId(params.accountId);
						const statementId = yield* parseStatementId(params.statementId);
						return yield* service.getLedgerAccountStatementEntries(
							token.orgId,
							ledgerId,
							accountId,
							statementId,
							query
						);
					}),
				runToCompletion
			)
			.handle(
				"create",
				({ params, headers, payload }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:account:statement:write"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const accountId = yield* parseAccountId(params.accountId);
						const statement = yield* service.createLedgerAccountStatement(
							token.orgId,
							ledgerId,
							accountId,
							headers["idempotency-key"],
							payload
						);
						return statement.toResponse();
					}),
				runToCompletion
			)
			.handle(
				"update",
				({ params, payload }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:account:statement:write"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const accountId = yield* parseAccountId(params.accountId);
						const statementId = yield* parseStatementId(params.statementId);
						const statement = yield* service.updateLedgerAccountStatement(
							token.orgId,
							ledgerId,
							accountId,
							statementId,
							payload
						);
						return statement.toResponse();
					}),
				runToCompletion
			);
	})
);

export { LedgerAccountStatementRoutes };
