import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { LedgersTable } from "@/repo/schema";
import type { LedgerRequest, LedgerResponse } from "@/routes/ledgers/schema";
import type { LedgerID, OrgID } from "./types";

// Infer types from Drizzle schema
type LedgerRecord = InferSelectModel<typeof LedgersTable>;
type LedgerInsert = InferInsertModel<typeof LedgersTable>;

interface LedgerEntityOptions {
	id: LedgerID;
	organizationId: OrgID;
	name: string;
	description?: string;
	currency: string;
	currencyExponent: number;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
}

class LedgerEntity {
	public readonly id: LedgerID;
	public readonly organizationId: OrgID;
	public readonly name: string;
	public readonly description?: string;
	public readonly currency: string;
	public readonly currencyExponent: number;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;

	constructor(options: LedgerEntityOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.name = options.name;
		this.description = options.description;
		this.currency = options.currency;
		this.currencyExponent = options.currencyExponent;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	// Create entity from API request
	public static fromRequest(rq: LedgerRequest, organizationId: OrgID, id?: string): LedgerEntity {
		const now = new Date();
		return new LedgerEntity({
			id: id ? TypeID.fromString<"lgr">(id) : new TypeID("lgr"),
			organizationId,
			name: rq.name,
			description: rq.description,
			currency: rq.currency ?? "USD",
			currencyExponent: rq.currencyExponent ?? 2,
			metadata: rq.metadata,
			created: now,
			updated: now,
		});
	}

	// Create entity from database record
	public static fromRecord(record: LedgerRecord): LedgerEntity {
		// Parse metadata from TEXT (JSON string) to object
		let metadata: Record<string, unknown> | undefined;
		if (record.metadata) {
			try {
				metadata = JSON.parse(record.metadata) as Record<string, unknown>;
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerEntity({
			id: TypeID.fromString<"lgr">(record.id),
			organizationId: TypeID.fromString<"org">(record.organizationId),
			name: record.name,
			description: record.description ?? undefined,
			currency: record.currency,
			currencyExponent: record.currencyExponent,
			metadata,
			created: record.created,
			updated: record.updated,
		});
	}

	// Convert entity to database record for insert/update
	public toRecord(): LedgerInsert {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			name: this.name,
			description: this.description ?? undefined,
			currency: this.currency,
			currencyExponent: this.currencyExponent,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			created: this.created,
			updated: this.updated,
		};
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
		};
	}
}

export type { LedgerEntityOptions as LedgerEntityOpts, LedgerRecord, LedgerInsert };
export { LedgerEntity };

export type { LedgerID } from "./types";
