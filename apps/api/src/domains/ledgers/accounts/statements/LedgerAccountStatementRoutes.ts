import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { CurrentToken, requirePermissions } from "@/auth";
import { LedgerAccountStatementServiceTag } from "./LedgerAccountStatementService";
import { runToCompletion } from "@/lib/utils";

/** Statement routes; the path ledgerId/accountId are ignored, the create body carries them. */
const LedgerAccountStatementRoutes = HttpApiBuilder.group(LedgerApi, "statements", handlers =>
	Effect.gen(function* () {
		const service = yield* LedgerAccountStatementServiceTag;
		return handlers
			.handle("get", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:statement:read"]);
					const token = yield* CurrentToken;
					const statement = yield* service.getLedgerAccountStatement(params.statementId, token.orgId);
					return statement.toResponse();
				})
			)
			.handle(
				"create",
				({ payload }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:account:statement:write"]);
						const token = yield* CurrentToken;
						const statement = yield* service.createLedgerAccountStatement(payload, token.orgId);
						return statement.toResponse();
					}),
				runToCompletion
			);
	})
);

export { LedgerAccountStatementRoutes };
