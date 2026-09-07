import { Effect } from "effect";
import { DateTime } from "luxon";

import {
	encodeUuid,
	encodeMetadata,
	type Metadata,
	parseDate,
	parseUuid,
	parseMetadata,
} from "@/lib/utils";
import type { LedgerAccountBalanceMonitorID, LedgerAccountID } from "@/repo/entities/types";
import type {
	LedgerAccountBalanceMonitorRow,
	LedgerAccountBalanceMonitorsTable,
} from "@/repo/schema";

import { LedgerAccountBalanceMonitorPersistenceDecodingFailure } from "./LedgerAccountBalanceMonitorErrors";
import type {
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
} from "./LedgerAccountBalanceMonitorSchema";

type LedgerAccountBalanceMonitorWriteRow = typeof LedgerAccountBalanceMonitorsTable.$inferInsert;

type LedgerAccountBalanceMonitorOptions = Readonly<{
	id: LedgerAccountBalanceMonitorID;
	accountId: LedgerAccountID;
	name: string;
	description?: string;
	alertThreshold: number;
	isActive: boolean;
	metadata?: Metadata;
	created: DateTime;
	updated: DateTime;
}>;

const toIso = (value: DateTime): string => {
	const encoded = value.toISO();
	if (encoded === null) throw new Error("Balance monitor contains an invalid timestamp");
	return encoded;
};

class LedgerAccountBalanceMonitor {
	readonly id: LedgerAccountBalanceMonitorID;
	readonly accountId: LedgerAccountID;
	readonly name: string;
	readonly description?: string;
	readonly alertThreshold: number;
	readonly isActive: boolean;
	readonly metadata?: Metadata;
	readonly created: DateTime;
	readonly updated: DateTime;

	private constructor(options: LedgerAccountBalanceMonitorOptions) {
		this.id = options.id;
		this.accountId = options.accountId;
		this.name = options.name;
		this.description = options.description;
		this.alertThreshold = options.alertThreshold;
		this.isActive = options.isActive;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	static fromRequest(
		id: LedgerAccountBalanceMonitorID,
		accountId: LedgerAccountID,
		request: LedgerAccountBalanceMonitorRequest,
		applicationTime: DateTime
	): LedgerAccountBalanceMonitor {
		return new LedgerAccountBalanceMonitor({
			id,
			accountId,
			name: request.description || "Balance Monitor",
			description: request.description,
			alertThreshold: 0,
			isActive: true,
			metadata: request.metadata,
			created: applicationTime,
			updated: applicationTime,
		});
	}

	static fromRow(
		row: LedgerAccountBalanceMonitorRow
	): Effect.Effect<
		LedgerAccountBalanceMonitor,
		LedgerAccountBalanceMonitorPersistenceDecodingFailure
	> {
		return Effect.all({
			id: parseUuid<"lbm", LedgerAccountBalanceMonitorID>("lbm", row.id),
			accountId: parseUuid<"lat", LedgerAccountID>("lat", row.accountId),
			created: parseDate(row.created),
			updated: parseDate(row.updated),
			metadata: parseMetadata(row.metadata).pipe(Effect.catch(() => Effect.succeed(undefined))),
		}).pipe(
			Effect.map(
				decoded =>
					new LedgerAccountBalanceMonitor({
						...decoded,
						name: row.name,
						description: row.description ?? undefined,
						alertThreshold: Number.parseFloat(row.alertThreshold),
						isActive: row.isActive === 1,
					})
			),
			Effect.mapError(cause => new LedgerAccountBalanceMonitorPersistenceDecodingFailure(cause))
		);
	}

	toCreateRow(): LedgerAccountBalanceMonitorWriteRow {
		return this.toWriteRow();
	}

	toUpdateRow(): LedgerAccountBalanceMonitorWriteRow {
		return this.toWriteRow();
	}

	toResponse(): LedgerAccountBalanceMonitorResponse {
		return {
			id: this.id.toString(),
			accountId: this.accountId.toString(),
			description: this.description,
			alertCondition: [],
			balances: [
				{
					balanceType: "pending",
					amount: 0,
					currency: "USD",
					currencyExponent: 2,
					credits: 0,
					debits: 0,
				},
				{
					balanceType: "posted",
					amount: 0,
					currency: "USD",
					currencyExponent: 2,
					credits: 0,
					debits: 0,
				},
				{
					balanceType: "availableBalance",
					amount: 0,
					currency: "USD",
					currencyExponent: 2,
					credits: 0,
					debits: 0,
				},
			],
			metadata: this.metadata,
			lockVersion: 0,
			created: toIso(this.created),
			updated: toIso(this.updated),
		};
	}

	private toWriteRow(): LedgerAccountBalanceMonitorWriteRow {
		return {
			id: encodeUuid(this.id),
			accountId: encodeUuid(this.accountId),
			name: this.name,
			description: this.description,
			alertThreshold: this.alertThreshold.toString(),
			isActive: this.isActive ? 1 : 0,
			metadata: encodeMetadata(this.metadata),
			updated: this.updated.toJSDate(),
		};
	}
}

export { LedgerAccountBalanceMonitor };
