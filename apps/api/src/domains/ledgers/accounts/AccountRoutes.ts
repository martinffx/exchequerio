import { Effect } from "effect";
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { CurrentToken, requirePermissions } from "@/auth";
import type { LedgerAccountID } from "@/lib/ids";
import { parseId, parseLedgerId } from "@/lib/utils";
import { AccountServiceTag } from "./AccountService";

const AccountRoutes = HttpApiBuilder.group(LedgerApi, "accounts", handlers =>
	Effect.gen(function* () {
		const service = yield* AccountServiceTag;
		return handlers
			.handle("list", ({ params, query }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:read"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const accounts = yield* service.listAccounts(token.orgId, ledgerId, query);
					return accounts.map(account => account.toResponse());
				})
			)
			.handle("get", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:read"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const accountId = yield* parseId<"lat", LedgerAccountID>("lat", params.accountId);
					const account = yield* service.getAccount(token.orgId, ledgerId, accountId);
					return account.toResponse();
				})
			)
			.handle("create", ({ params, payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const account = yield* service.createAccount(token.orgId, ledgerId, payload);
					return HttpApiSchema.withHeaders({
						body: account.toResponse(),
						headers: {
							location: `/api/ledgers/${account.ledgerId.toString()}/accounts/${account.id.toString()}`,
						},
					});
				})
			)
			.handle("update", ({ params, payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const accountId = yield* parseId<"lat", LedgerAccountID>("lat", params.accountId);
					const account = yield* service.updateAccount(token.orgId, ledgerId, accountId, payload);
					return account.toResponse();
				})
			)
			.handle("delete", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:delete"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const accountId = yield* parseId<"lat", LedgerAccountID>("lat", params.accountId);
					yield* service.deleteAccount(token.orgId, ledgerId, accountId);
				})
			);
	})
);

export { AccountRoutes };
