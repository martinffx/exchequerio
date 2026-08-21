import { Effect } from "effect";

import { parseId, parseMetadata } from "@/lib/utils";
import {
	newLedgerTransactionEntryID,
	type LedgerAccountID,
	type LedgerID,
	type LedgerTransactionEntryID,
	type LedgerTransactionID,
	type OrgID,
} from "@/repo/entities/types";
import type { LedgerTransactionEntriesTable } from "@/repo/schema";

import { TransactionValidationFailure } from "../TransactionErrors";
import type { CurrencyCode } from "@/ledgers/accounts";

type TransactionMetadata = Readonly<Record<string, string>>;
type TransactionEntryDirection = "debit" | "credit";
type TransactionEntryRequest = Readonly<{
	accountId: string;
	direction: TransactionEntryDirection;
	amount: number;
	currencyCode: string;
	metadata?: Record<string, string>;
}>;

type TransactionEntryOptions = Readonly<{
	id: LedgerTransactionEntryID;
	accountId: LedgerAccountID;
	direction: TransactionEntryDirection;
	amount: number;
	currency: CurrencyCode;
	metadata?: TransactionMetadata;
}>;

type TransactionEntryPersistenceRow = Pick<
	typeof LedgerTransactionEntriesTable.$inferSelect,
	"id" | "transactionId" | "accountId" | "direction" | "amount" | "metadata"
> & {
	readonly currencyCode: string;
	readonly minorUnitExponent: number;
};

type TransactionEntryParent = Readonly<{
	id: LedgerTransactionID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	updated: { toJSDate(): Date };
}>;

const validationFailure = (message: string): TransactionValidationFailure =>
	new TransactionValidationFailure(message);

const validateMetadata = (metadata: TransactionMetadata | undefined): void => {
	if (metadata === undefined) return;
	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
		throw validationFailure("Transaction Entry metadata must be an object");
	}
	if (!Object.values(metadata).every(value => typeof value === "string")) {
		throw validationFailure("Transaction Entry metadata values must be strings");
	}
};

const encodeMetadata = (metadata: TransactionMetadata | undefined): string | null =>
	// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
	metadata === undefined ? null : JSON.stringify(metadata);

class TransactionEntry {
	readonly id: LedgerTransactionEntryID;
	readonly accountId: LedgerAccountID;
	readonly direction: TransactionEntryDirection;
	readonly amount: number;
	readonly currency: CurrencyCode;
	readonly metadata?: TransactionMetadata;

	private constructor(options: TransactionEntryOptions) {
		this.id = options.id;
		this.accountId = options.accountId;
		this.direction = options.direction;
		this.amount = options.amount;
		this.currency = options.currency;
		this.metadata = options.metadata;
	}

	private static validate(
		options: TransactionEntryOptions
	): Effect.Effect<void, TransactionValidationFailure> {
		return Effect.try({
			try: () => {
				if (options.direction !== "debit" && options.direction !== "credit") {
					throw validationFailure("Entry direction must be Debit or Credit");
				}
				if (!Number.isSafeInteger(options.amount) || options.amount <= 0) {
					throw validationFailure("Entry Amount must be a positive safe integer");
				}
				validateMetadata(options.metadata);
			},
			catch: cause =>
				cause instanceof TransactionValidationFailure ? cause : validationFailure("Entry is invalid"),
		});
	}

	static fromRequest(
		request: TransactionEntryRequest,
	): Effect.Effect<TransactionEntry, TransactionValidationFailure> {
		return parseId<"lat", LedgerAccountID>("lat", request.accountId).pipe(
			Effect.mapError(() => validationFailure(`Invalid Account ID: ${request.accountId}`)),
			Effect.flatMap(accountId => {
				const options: TransactionEntryOptions = {
					id: newLedgerTransactionEntryID(),
					accountId,
					direction: request.direction,
					amount: request.amount,
					currency: request.currencyCode,
					metadata: request.metadata,
				};
				return TransactionEntry.validate(options).pipe(Effect.map(() => new TransactionEntry(options)));
			})
		);
	}

	static fromRow(
		row: TransactionEntryPersistenceRow
	): Effect.Effect<TransactionEntry, Error | TransactionValidationFailure> {
		return Effect.all({
			id: parseId<"lte", LedgerTransactionEntryID>("lte", row.id),
			accountId: parseId<"lat", LedgerAccountID>("lat", row.accountId),
			metadata: parseMetadata(row.metadata),
		}).pipe(
			Effect.flatMap(decoded => {
				const options: TransactionEntryOptions = {
          ...decoded,
          currency: row.currencyCode,
					direction: row.direction,
					amount: row.amount,
				};
				return TransactionEntry.validate(options).pipe(Effect.map(() => new TransactionEntry(options)));
			})
		);
	}

	toRow(transaction: TransactionEntryParent): typeof LedgerTransactionEntriesTable.$inferInsert {
		return {
			id: this.id.toString(),
			transactionId: transaction.id.toString(),
			accountId: this.accountId.toString(),
			organizationId: transaction.organizationId.toString(),
			ledgerId: transaction.ledgerId.toString(),
			direction: this.direction,
			amount: this.amount,
			metadata: encodeMetadata(this.metadata),
			created: transaction.updated.toJSDate(),
		};
	}
}

export type {
	TransactionEntryDirection,
	TransactionEntryOptions,
	TransactionEntryPersistenceRow,
	TransactionEntryRequest,
};
export { TransactionEntry };
