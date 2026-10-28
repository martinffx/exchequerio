import { Effect } from "effect";
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { CurrentToken, requirePermissions } from "@/auth";
import { parseLedgerId, runToCompletion } from "@/lib/utils";
import { LedgerServiceTag } from "./LedgerService";

const LedgerRoutes = HttpApiBuilder.group(LedgerApi, "ledgers", handlers =>
	Effect.gen(function* () {
		const service = yield* LedgerServiceTag;
		return handlers
			.handle("list", ({ query }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:read"]);
					const token = yield* CurrentToken;
					const ledgers = yield* service.listLedgers(token.orgId, {
						offset: query.offset,
						limit: query.limit,
					});
					return ledgers.map(ledger => ledger.toResponse());
				})
			)
			.handle("get", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:read"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const ledger = yield* service.getLedger(token.orgId, ledgerId);
					return ledger.toResponse();
				})
			)
			.handle(
				"create",
				({ payload }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:write"]);
						const token = yield* CurrentToken;
						const ledger = yield* service.createLedger(token.orgId, payload);
						return HttpApiSchema.withHeaders({
							body: ledger.toResponse(),
							headers: { location: `/api/ledgers/${ledger.id.toString()}` },
						});
					}),
				runToCompletion
			)
			.handle(
				"update",
				({ params, payload }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:write"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const ledger = yield* service.updateLedger(token.orgId, ledgerId, payload);
						return ledger.toResponse();
					}),
				runToCompletion
			)
			.handle(
				"delete",
				({ params }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:delete"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						yield* service.deleteLedger(token.orgId, ledgerId);
					}),
				runToCompletion
			);
	})
);

export { LedgerRoutes };
