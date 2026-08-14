import type { LedgerID, OrgID } from "@/repo/entities/types";

type LedgerMetadata = Readonly<Record<string, string>>;

type LedgerOptions = {
	readonly id: LedgerID;
	readonly organizationId: OrgID;
	readonly name: string;
	readonly description?: string;
	readonly metadata?: LedgerMetadata;
	readonly created: Date;
	readonly updated: Date;
};

type LedgerWrite = Omit<LedgerOptions, "created" | "updated">;

class Ledger {
	readonly id: LedgerID;
	readonly organizationId: OrgID;
	readonly name: string;
	readonly description?: string;
	readonly metadata?: LedgerMetadata;
	readonly created: Date;
	readonly updated: Date;

	constructor(options: LedgerOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.name = options.name;
		this.description = options.description;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}
}

export type { LedgerMetadata, LedgerOptions, LedgerWrite };
export { Ledger };
