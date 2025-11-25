import type { LedgerRequest, LedgerResponse } from "@/routes/ledgers/schema"
import type { LedgersTable } from "@/repo/schema"
import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import { TypeID } from "typeid-js"

// Infer types from Drizzle schema
type LedgerRecord = InferSelectModel<typeof LedgersTable>
type LedgerInsert = InferInsertModel<typeof LedgersTable>

type LedgerID = TypeID<"lgr">
type OrgID = TypeID<"org">

interface LedgerEntityOpts {
	id: LedgerID
	organizationId: OrgID
	name: string
	description?: string
	currency: string
	currencyExponent: number
	metadata?: Record<string, unknown>
	created: Date
	updated: Date
}

class LedgerEntity {
	public readonly id: LedgerID
	public readonly organizationId: OrgID
	public readonly name: string
	public readonly description?: string
	public readonly currency: string
	public readonly currencyExponent: number
	public readonly metadata?: Record<string, unknown>
	public readonly created: Date
	public readonly updated: Date

	constructor(opts: LedgerEntityOpts) {
		this.id = opts.id
		this.organizationId = opts.organizationId
		this.name = opts.name
		this.description = opts.description
		this.currency = opts.currency
		this.currencyExponent = opts.currencyExponent
		this.metadata = opts.metadata
		this.created = opts.created
		this.updated = opts.updated
	}

	// Create entity from API request
	public static fromRequest(rq: LedgerRequest, organizationId: OrgID, id?: string): LedgerEntity {
		const now = new Date()
		return new LedgerEntity({
			id: id ? TypeID.fromString<"lgr">(id) : new TypeID("lgr"),
			organizationId,
			name: rq.name,
			description: rq.description,
			currency: "USD", // TODO: Make configurable
			currencyExponent: 2, // TODO: Make configurable
			metadata: rq.metadata,
			created: now,
			updated: now,
		})
	}

	// Create entity from database record
	public static fromRecord(record: LedgerRecord): LedgerEntity {
		return new LedgerEntity({
			id: TypeID.fromString<"lgr">(record.id),
			organizationId: TypeID.fromString<"org">(record.organizationId),
			name: record.name,
			description: record.description ?? undefined,
			currency: record.currency,
			currencyExponent: record.currencyExponent,
			metadata: record.metadata as Record<string, unknown> | undefined,
			created: record.created,
			updated: record.updated,
		})
	}

	// Convert entity to database record for insert/update
	public toRecord(): LedgerInsert {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			name: this.name,
			description: this.description ?? null,
			currency: this.currency,
			currencyExponent: this.currencyExponent,
			metadata: this.metadata,
			created: this.created,
			updated: this.updated,
		}
	}

	// Convert entity to API response
	public toResponse(): LedgerResponse {
		return {
			id: this.id.toString(),
			name: this.name,
			description: this.description,
			metadata: this.metadata,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		}
	}
}

export type { LedgerID, LedgerEntityOpts, LedgerRecord, LedgerInsert }
export { LedgerEntity }
