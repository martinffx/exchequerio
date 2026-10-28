import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import {
	BadRequestApiError,
	ConflictApiError,
	ForbiddenApiError,
	InternalServerApiError,
	NotFoundApiError,
	ServiceUnavailableApiError,
	TooManyRequestsApiError,
	UnauthorizedApiError,
} from "@/lib/errors";
import {
	LedgerAccountSettlementCollectionParameters,
	LedgerAccountSettlementEntriesRequest,
	LedgerAccountSettlementEntryListResponse,
	LedgerAccountSettlementIdParams,
	LedgerAccountSettlementListQuery,
	LedgerAccountSettlementListResponse,
	LedgerAccountSettlementPatchRequest,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	LedgerAccountSettlementWriteHeaders,
} from "./LedgerAccountSettlementSchema";

// Collection paths keep their trailing slash, as today's OpenAPI document has it.
// Every Settlement route declared 429 under Fastify, so the whole group keeps it.
const commonErrors = [
	BadRequestApiError,
	UnauthorizedApiError,
	ForbiddenApiError,
	TooManyRequestsApiError,
	InternalServerApiError,
	ServiceUnavailableApiError,
] as const;

const operation = (identifier: string, summary: string, description: string) =>
	OpenApi.annotations({ identifier, summary, description });

const SettlementsApi = HttpApiGroup.make("settlements")
	.add(
		HttpApiEndpoint.get("list", "/ledgers/:ledgerId/settlements/", {
			params: LedgerAccountSettlementCollectionParameters,
			query: LedgerAccountSettlementListQuery,
			success: LedgerAccountSettlementListResponse,
			error: commonErrors,
		}).annotateMerge(
			operation(
				"listLedgerAccountSettlements",
				"List Ledger Account Settlements",
				"List all settlements for a ledger"
			)
		),
		HttpApiEndpoint.get("get", "/ledgers/:ledgerId/settlements/:settlementId", {
			params: LedgerAccountSettlementIdParams,
			success: LedgerAccountSettlementResponse,
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(
			operation(
				"getLedgerAccountSettlement",
				"Get Ledger Account Settlement",
				"Get a single settlement by ID"
			)
		),
		HttpApiEndpoint.post("create", "/ledgers/:ledgerId/settlements/", {
			params: LedgerAccountSettlementCollectionParameters,
			headers: LedgerAccountSettlementWriteHeaders,
			payload: LedgerAccountSettlementRequest,
			success: HttpApiSchema.WithHeaders(
				LedgerAccountSettlementResponse.pipe(HttpApiSchema.status(201)),
				{ location: Schema.String }
			),
			// Legacy did not declare 404, but the service fails with it when the settled Account is missing.
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(
			operation(
				"createLedgerAccountSettlement",
				"Create Ledger Account Settlement",
				"Create a Settlement; defaults to pending status"
			)
		),
		HttpApiEndpoint.patch("patch", "/ledgers/:ledgerId/settlements/:settlementId", {
			params: LedgerAccountSettlementIdParams,
			headers: LedgerAccountSettlementWriteHeaders,
			payload: LedgerAccountSettlementPatchRequest,
			success: LedgerAccountSettlementResponse,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(
			operation(
				"patchLedgerAccountSettlement",
				"Update Ledger Account Settlement",
				"Update Settlement metadata or lifecycle status"
			)
		),
		HttpApiEndpoint.patch("addEntries", "/ledgers/:ledgerId/settlements/:settlementId/entries", {
			params: LedgerAccountSettlementIdParams,
			headers: LedgerAccountSettlementWriteHeaders,
			payload: LedgerAccountSettlementEntriesRequest,
			success: HttpApiSchema.NoContent,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(
			operation(
				"addLedgerAccountSettlementEntries",
				"Add Ledger Account Settlement Entries",
				"Attach ledger entries to a drafting settlement. Only entries from the settled account that are posted can be attached."
			)
		),
		HttpApiEndpoint.delete("removeEntries", "/ledgers/:ledgerId/settlements/:settlementId/entries", {
			params: LedgerAccountSettlementIdParams,
			headers: LedgerAccountSettlementWriteHeaders,
			payload: LedgerAccountSettlementEntriesRequest,
			success: HttpApiSchema.NoContent,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(
			operation(
				"removeLedgerAccountSettlementEntries",
				"Remove Ledger Account Settlement Entries",
				"Remove ledger entries from a drafting settlement."
			)
		),
		HttpApiEndpoint.get("listEntries", "/ledgers/:ledgerId/settlements/:settlementId/entries", {
			params: LedgerAccountSettlementIdParams,
			query: LedgerAccountSettlementListQuery,
			success: LedgerAccountSettlementEntryListResponse,
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(
			operation(
				"listLedgerAccountSettlementEntries",
				"List Settlement source Entries",
				"List the source Entries belonging to a Settlement"
			)
		)
	)
	.annotateMerge(
		OpenApi.annotations({
			title: "Ledger Account Settlements",
			description: "A settlement nets posted entries of a ledger account into a balanced transaction.",
		})
	);

export { SettlementsApi };
