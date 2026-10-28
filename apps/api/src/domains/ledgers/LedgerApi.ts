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
	LedgerCreateRequest,
	LedgerIdParameters,
	LedgerListQuery,
	LedgerResponse,
	LedgerUpdateRequest,
} from "./LedgerSchema";

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

const LedgersApi = HttpApiGroup.make("ledgers")
	.add(
		HttpApiEndpoint.get("list", "/ledgers/", {
			query: LedgerListQuery,
			success: Schema.Array(LedgerResponse),
			error: commonErrors,
		}).annotateMerge(operation("listLedgers", "List Ledgers")),
		HttpApiEndpoint.get("get", "/ledgers/:ledgerId", {
			params: LedgerIdParameters,
			success: LedgerResponse,
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(operation("getLedger", "Get a Ledger")),
		HttpApiEndpoint.post("create", "/ledgers/", {
			payload: LedgerCreateRequest,
			success: HttpApiSchema.WithHeaders(LedgerResponse.pipe(HttpApiSchema.status(201)), {
				location: Schema.String,
			}),
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(operation("createLedger", "Create a Ledger")),
		HttpApiEndpoint.put("update", "/ledgers/:ledgerId", {
			params: LedgerIdParameters,
			payload: LedgerUpdateRequest,
			success: LedgerResponse,
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(operation("updateLedger", "Replace a Ledger")),
		HttpApiEndpoint.delete("delete", "/ledgers/:ledgerId", {
			params: LedgerIdParameters,
			success: HttpApiSchema.NoContent,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("deleteLedger", "Delete a Ledger"))
	)
	.annotateMerge(
		OpenApi.annotations({
			title: "Ledgers",
			description: "A ledger represents a standard chart of ledger accounts.",
		})
	);

export { LedgersApi };
