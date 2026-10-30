import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { ConflictApiError, NotFoundApiError, operation, throttledErrors } from "@/lib/ApiContract";
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

// Every Settlement route declares 429, so the whole group keeps it.

const SettlementsApi = HttpApiGroup.make("settlements")
	.add(
		HttpApiEndpoint.get("list", "/ledgers/:ledgerId/settlements/", {
			params: LedgerAccountSettlementCollectionParameters,
			query: LedgerAccountSettlementListQuery,
			success: LedgerAccountSettlementListResponse,
			error: throttledErrors,
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
			error: [NotFoundApiError, ...throttledErrors],
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
			// The service fails with 404 when the settled Account is missing.
			error: [NotFoundApiError, ConflictApiError, ...throttledErrors],
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
			error: [NotFoundApiError, ConflictApiError, ...throttledErrors],
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
			error: [NotFoundApiError, ConflictApiError, ...throttledErrors],
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
			error: [NotFoundApiError, ConflictApiError, ...throttledErrors],
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
			error: [NotFoundApiError, ...throttledErrors],
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
