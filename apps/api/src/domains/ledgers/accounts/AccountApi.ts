import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import {
	BadRequestApiError,
	ConflictApiError,
	ForbiddenApiError,
	InternalServerApiError,
	NotFoundApiError,
	ServiceUnavailableApiError,
	UnauthorizedApiError,
} from "@/lib/errors";
import {
	AccountCollectionParameters,
	AccountCreateRequest,
	AccountItemParameters,
	AccountListQuery,
	AccountResponse,
	AccountUpdateRequest,
} from "./AccountSchema";

// Collection paths keep their trailing slash, as today's OpenAPI document has it.
const commonErrors = [
	BadRequestApiError,
	UnauthorizedApiError,
	ForbiddenApiError,
	InternalServerApiError,
	ServiceUnavailableApiError,
] as const;

const operation = (identifier: string, summary: string) =>
	OpenApi.annotations({ identifier, summary });

const AccountsApi = HttpApiGroup.make("accounts")
	.add(
		HttpApiEndpoint.get("list", "/ledgers/:ledgerId/accounts/", {
			params: AccountCollectionParameters,
			query: AccountListQuery,
			success: Schema.Array(AccountResponse),
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(operation("listLedgerAccounts", "List Ledger Accounts")),
		HttpApiEndpoint.get("get", "/ledgers/:ledgerId/accounts/:accountId", {
			params: AccountItemParameters,
			success: AccountResponse,
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(operation("getLedgerAccount", "Get a Ledger Account")),
		HttpApiEndpoint.post("create", "/ledgers/:ledgerId/accounts/", {
			params: AccountCollectionParameters,
			payload: AccountCreateRequest,
			success: HttpApiSchema.WithHeaders(AccountResponse.pipe(HttpApiSchema.status(201)), {
				location: Schema.String,
			}),
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("createLedgerAccount", "Create a Ledger Account")),
		HttpApiEndpoint.put("update", "/ledgers/:ledgerId/accounts/:accountId", {
			params: AccountItemParameters,
			payload: AccountUpdateRequest,
			success: AccountResponse,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("updateLedgerAccount", "Replace a Ledger Account")),
		HttpApiEndpoint.delete("delete", "/ledgers/:ledgerId/accounts/:accountId", {
			params: AccountItemParameters,
			success: HttpApiSchema.NoContent,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("deleteLedgerAccount", "Delete a Ledger Account"))
	)
	.annotateMerge(
		OpenApi.annotations({
			title: "Ledger Accounts",
			description: "A ledger account holds balances for one asset within a ledger.",
		})
	);

export { AccountsApi };
