import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { ConflictApiError, NotFoundApiError } from "@/lib/errors";
import { commonErrors, operation } from "@/lib/ApiContract";
import {
	TransactionCollectionParameters,
	TransactionCreateHeaders,
	TransactionCreateRequest,
	TransactionItemParameters,
	TransactionListQuery,
	TransactionListResponse,
	TransactionResponse,
	TransactionUpdateRequest,
} from "./LedgerTransactionSchema";

// Collection paths keep their trailing slash, as today's OpenAPI document has it.

const TransactionsApi = HttpApiGroup.make("transactions")
	.add(
		HttpApiEndpoint.get("list", "/ledgers/:ledgerId/transactions/", {
			params: TransactionCollectionParameters,
			query: TransactionListQuery,
			success: TransactionListResponse,
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(operation("listLedgerTransactions", "List Ledger Transactions")),
		HttpApiEndpoint.get("get", "/ledgers/:ledgerId/transactions/:transactionId", {
			params: TransactionItemParameters,
			success: TransactionResponse,
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(operation("getLedgerTransaction", "Get a Ledger Transaction")),
		HttpApiEndpoint.post("create", "/ledgers/:ledgerId/transactions/", {
			params: TransactionCollectionParameters,
			headers: TransactionCreateHeaders,
			payload: TransactionCreateRequest,
			success: HttpApiSchema.WithHeaders(TransactionResponse.pipe(HttpApiSchema.status(201)), {
				location: Schema.String,
			}),
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("createLedgerTransaction", "Create a Ledger Transaction")),
		HttpApiEndpoint.put("update", "/ledgers/:ledgerId/transactions/:transactionId", {
			params: TransactionItemParameters,
			headers: TransactionCreateHeaders,
			payload: TransactionUpdateRequest,
			success: TransactionResponse,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("updateLedgerTransaction", "Update a Ledger Transaction")),
		HttpApiEndpoint.post("post", "/ledgers/:ledgerId/transactions/:transactionId/post", {
			params: TransactionItemParameters,
			headers: TransactionCreateHeaders,
			success: TransactionResponse,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("postLedgerTransaction", "Post a Ledger Transaction")),
		HttpApiEndpoint.delete("void", "/ledgers/:ledgerId/transactions/:transactionId", {
			params: TransactionItemParameters,
			headers: TransactionCreateHeaders,
			success: HttpApiSchema.NoContent,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("voidLedgerTransaction", "Void a Ledger Transaction"))
	)
	.annotateMerge(
		OpenApi.annotations({
			title: "Ledger Transactions",
			description: "A ledger transaction records balanced entries across ledger accounts.",
		})
	);

export { TransactionsApi };
