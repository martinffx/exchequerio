import { TypeID } from "typeid-js";

import {
	newLedgerAccountSettlementID,
	type LedgerAccountID,
	type LedgerAccountSettlementID,
	type LedgerTransactionID,
	type OrgID,
} from "@/repo/entities/types";
import { LedgerAccountSettlementsTable, type LedgerAccountSettlementRow } from "@/repo/schema";

import type {
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	NormalBalance,
	SettlementStatus,
} from "./LedgerAccountSettlementSchema";

type LedgerAccountSettlementInsert = typeof LedgerAccountSettlementsTable.$inferInsert;

type LedgerAccountSettlementEntityOptions = Readonly<{
	id: LedgerAccountSettlementID;
	organizationId: OrgID;
	transactionId?: LedgerTransactionID;
	settledAccountId: LedgerAccountID;
	contraAccountId: LedgerAccountID;
	amount: number;
	normalBalance: NormalBalance;
	currency: string;
	status: SettlementStatus;
	description?: string;
	externalReference?: string;
	effectiveAtUpperBound?: Date;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
}>;

class LedgerAccountSettlementEntity {
	readonly id: LedgerAccountSettlementID;
	readonly organizationId: OrgID;
	readonly transactionId?: LedgerTransactionID;
	readonly settledAccountId: LedgerAccountID;
	readonly contraAccountId: LedgerAccountID;
	readonly amount: number;
	readonly normalBalance: NormalBalance;
	readonly currency: string;
	readonly status: SettlementStatus;
	readonly description?: string;
	readonly externalReference?: string;
	readonly effectiveAtUpperBound?: Date;
	readonly metadata?: Record<string, unknown>;
	readonly created: Date;
	readonly updated: Date;

	constructor(options: LedgerAccountSettlementEntityOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.transactionId = options.transactionId;
		this.settledAccountId = options.settledAccountId;
		this.contraAccountId = options.contraAccountId;
		this.amount = options.amount;
		this.normalBalance = options.normalBalance;
		this.currency = options.currency;
		this.status = options.status;
		this.description = options.description;
		this.externalReference = options.externalReference;
		this.effectiveAtUpperBound = options.effectiveAtUpperBound;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	static fromRequest(
		request: LedgerAccountSettlementRequest,
		organizationId: OrgID,
		currency: string,
		normalBalance: NormalBalance,
		id?: string
	): LedgerAccountSettlementEntity {
		const now = new Date();
		return new LedgerAccountSettlementEntity({
			id: id ? TypeID.fromString<"las">(id) : newLedgerAccountSettlementID(),
			organizationId,
			transactionId: request.transactionId
				? TypeID.fromString<"ltr">(request.transactionId)
				: undefined,
			settledAccountId: TypeID.fromString<"lat">(request.settledAccountId),
			contraAccountId: TypeID.fromString<"lat">(request.contraAccountId),
			amount: 0,
			normalBalance,
			currency,
			status: request.status,
			description: request.description,
			externalReference: request.externalReference,
			effectiveAtUpperBound: request.effectiveAtUpperBound
				? new Date(request.effectiveAtUpperBound)
				: undefined,
			metadata: request.metadata,
			created: now,
			updated: now,
		});
	}

	static fromRow(row: LedgerAccountSettlementRow): LedgerAccountSettlementEntity {
		let metadata: Record<string, unknown> | undefined;
		if (row.metadata) {
			try {
				metadata = JSON.parse(row.metadata) as Record<string, unknown>;
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerAccountSettlementEntity({
			id: TypeID.fromString<"las">(row.id),
			organizationId: TypeID.fromString<"org">(row.organizationId),
			transactionId: row.transactionId ? TypeID.fromString<"ltr">(row.transactionId) : undefined,
			settledAccountId: TypeID.fromString<"lat">(row.settledAccountId),
			contraAccountId: TypeID.fromString<"lat">(row.contraAccountId),
			amount: row.amount,
			normalBalance: row.normalBalance,
			currency: row.currency,
			status: row.status,
			description: row.description ?? undefined,
			externalReference: row.externalReference ?? undefined,
			effectiveAtUpperBound: row.effectiveAtUpperBound ?? undefined,
			metadata,
			created: row.created,
			updated: row.updated,
		});
	}

	toRow(): LedgerAccountSettlementInsert {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			transactionId: this.transactionId?.toString() ?? undefined,
			settledAccountId: this.settledAccountId.toString(),
			contraAccountId: this.contraAccountId.toString(),
			amount: this.amount,
			normalBalance: this.normalBalance,
			currency: this.currency,
			status: this.status,
			description: this.description ?? undefined,
			externalReference: this.externalReference ?? undefined,
			effectiveAtUpperBound: this.effectiveAtUpperBound ?? undefined,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			created: this.created,
			updated: this.updated,
		};
	}

	toResponse(): LedgerAccountSettlementResponse {
		return {
			id: this.id.toString(),
			transactionId: this.transactionId?.toString() ?? "",
			settledAccountId: this.settledAccountId.toString(),
			contraAccountId: this.contraAccountId.toString(),
			amount: this.amount,
			normalBalance: this.normalBalance,
			currency: this.currency,
			status: this.status,
			description: this.description,
			metadata: this.metadata as Record<string, string> | undefined,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}

	withAmount(amount: number): LedgerAccountSettlementEntity {
		return new LedgerAccountSettlementEntity({ ...this, amount, updated: new Date() });
	}

	withStatus(status: SettlementStatus): LedgerAccountSettlementEntity {
		return new LedgerAccountSettlementEntity({ ...this, status, updated: new Date() });
	}

	withTransactionId(transactionId: LedgerTransactionID): LedgerAccountSettlementEntity {
		return new LedgerAccountSettlementEntity({ ...this, transactionId, updated: new Date() });
	}
}

export type { LedgerAccountSettlementEntityOptions };
export { LedgerAccountSettlementEntity };
