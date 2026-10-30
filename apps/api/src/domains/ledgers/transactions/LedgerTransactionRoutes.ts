import { Effect } from "effect";
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { CurrentToken, requirePermissions } from "@/auth";
import type { LedgerTransactionID } from "@/lib/ids";
import { parseId, parseLedgerId, runToCompletion } from "@/lib/utils";
import { TransactionServiceTag } from "./LedgerTransactionService";

const parseTransactionId = (transactionId: string) =>
	parseId<"ltr", LedgerTransactionID>("ltr", transactionId);

const TransactionRoutes = HttpApiBuilder.group(LedgerApi, "transactions", handlers =>
	Effect.gen(function* () {
		const service = yield* TransactionServiceTag;
		return handlers
			.handle(
				"list",
				({ params, query }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:transaction:read"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const transactions = yield* service.listTransactions(token.orgId, ledgerId, query);
						return transactions.map(transaction => transaction.toListItemResponse());
					}),
				runToCompletion
			)
			.handle(
				"get",
				({ params }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:transaction:read"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const transactionId = yield* parseTransactionId(params.transactionId);
						const transaction = yield* service.getTransaction(token.orgId, ledgerId, transactionId);
						return transaction.toResponse();
					}),
				runToCompletion
			)
			.handle(
				"create",
				({ params, headers, payload }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:transaction:write"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const transaction = yield* service.createTransaction(
							token.orgId,
							ledgerId,
							headers["idempotency-key"],
							payload
						);
						return HttpApiSchema.withHeaders({
							body: transaction.toResponse(),
							headers: {
								location: `/api/ledgers/${transaction.ledgerId.toString()}/transactions/${transaction.id.toString()}`,
							},
						});
					}),
				runToCompletion
			)
			.handle(
				"update",
				({ params, headers, payload }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:transaction:write"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const transactionId = yield* parseTransactionId(params.transactionId);
						const transaction = yield* service.updateTransaction(
							token.orgId,
							ledgerId,
							transactionId,
							headers["idempotency-key"],
							payload
						);
						return transaction.toResponse();
					}),
				runToCompletion
			)
			.handle(
				"post",
				({ params, headers }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:transaction:write"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const transactionId = yield* parseTransactionId(params.transactionId);
						const transaction = yield* service.postTransaction(
							token.orgId,
							ledgerId,
							transactionId,
							headers["idempotency-key"]
						);
						return transaction.toResponse();
					}),
				runToCompletion
			)
			.handle(
				"void",
				({ params, headers }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["ledger:transaction:delete"]);
						const token = yield* CurrentToken;
						const ledgerId = yield* parseLedgerId(params.ledgerId);
						const transactionId = yield* parseTransactionId(params.transactionId);
						yield* service.voidTransaction(
							token.orgId,
							ledgerId,
							transactionId,
							headers["idempotency-key"]
						);
					}),
				runToCompletion
			);
	})
);

export { TransactionRoutes };
