import { Effect } from "effect";
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { CurrentToken, requirePermissions } from "@/auth";
import type { LedgerAccountSettlementID, LedgerID } from "@/lib/ids";
import { parseId } from "@/lib/utils";
import { LedgerAccountSettlementServiceTag } from "./LedgerAccountSettlementService";

const parseLedgerId = (ledgerId: string) => parseId<"lgr", LedgerID>("lgr", ledgerId);
const parseSettlementId = (settlementId: string) =>
	parseId<"las", LedgerAccountSettlementID>("las", settlementId);

/**
 * Settlement reads, lifecycle edits, and source membership routes.
 *
 * @remarks
 * Routes own transport validation and permissions. Mutation keys pass to the service;
 * void requests require both write and delete permissions.
 */
const SettlementRoutes = HttpApiBuilder.group(LedgerApi, "settlements", handlers =>
	Effect.gen(function* () {
		const service = yield* LedgerAccountSettlementServiceTag;
		return handlers
			.handle("list", ({ params, query }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:settlement:read"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const settlements = yield* service.listLedgerAccountSettlements(
						token.orgId,
						ledgerId,
						query.offset,
						query.limit
					);
					return settlements.map(settlement => settlement.toResponse());
				})
			)
			.handle("get", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:settlement:read"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const settlementId = yield* parseSettlementId(params.settlementId);
					const settlement = yield* service.getLedgerAccountSettlement(
						token.orgId,
						ledgerId,
						settlementId
					);
					return settlement.toResponse();
				})
			)
			.handle("create", ({ params, headers, payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:settlement:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const settlement = yield* service.createLedgerAccountSettlement(
						token.orgId,
						ledgerId,
						headers["idempotency-key"],
						payload
					);
					return HttpApiSchema.withHeaders({
						body: settlement.toResponse(),
						// Built from the raw path parameter, as the Fastify route did.
						headers: {
							location: `/api/ledgers/${params.ledgerId}/settlements/${settlement.id.toString()}`,
						},
					});
				})
			)
			.handle("patch", ({ params, headers, payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:settlement:write"]);
					if (payload.status === "voided")
						yield* requirePermissions(["ledger:account:settlement:delete"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const settlementId = yield* parseSettlementId(params.settlementId);
					const settlement = yield* service.patchLedgerAccountSettlement(
						token.orgId,
						ledgerId,
						settlementId,
						headers["idempotency-key"],
						payload
					);
					return settlement.toResponse();
				})
			)
			.handle("addEntries", ({ params, headers, payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:settlement:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const settlementId = yield* parseSettlementId(params.settlementId);
					yield* service.addLedgerAccountSettlementEntries(
						token.orgId,
						ledgerId,
						settlementId,
						headers["idempotency-key"],
						[...payload.entries]
					);
				})
			)
			.handle("removeEntries", ({ params, headers, payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:settlement:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const settlementId = yield* parseSettlementId(params.settlementId);
					yield* service.removeLedgerAccountSettlementEntries(
						token.orgId,
						ledgerId,
						settlementId,
						headers["idempotency-key"],
						[...payload.entries]
					);
				})
			)
			.handle("listEntries", ({ params, query }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:settlement:read"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const settlementId = yield* parseSettlementId(params.settlementId);
					return yield* service.listLedgerAccountSettlementEntries(
						token.orgId,
						ledgerId,
						settlementId,
						query.offset,
						query.limit
					);
				})
			);
	})
);

export { SettlementRoutes };
