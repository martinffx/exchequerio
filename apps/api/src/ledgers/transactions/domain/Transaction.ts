import { Effect } from "effect";
import { DateTime } from "luxon";

import { currencyEquals, makeCurrency, type Currency } from "@/ledgers/accounts";
import type {
	LedgerAccountID,
	LedgerID,
	LedgerTransactionEntryID,
	LedgerTransactionID,
	OrgID,
} from "@/repo/entities/types";

import { TransactionLifecycleConflict, TransactionValidationFailure } from "../TransactionErrors";

type TransactionStatus = "pending" | "posted" | "voided";
type EntryDirection = "debit" | "credit";
type TransactionMetadata = Readonly<Record<string, string>>;

type EntryOptions = {
	readonly id: LedgerTransactionEntryID;
	readonly accountId: LedgerAccountID;
	readonly direction: EntryDirection;
	readonly amount: number;
	readonly currency: Currency;
	readonly metadata?: TransactionMetadata;
};

type TransactionOptions = {
	readonly id: LedgerTransactionID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	readonly status: TransactionStatus;
	readonly description?: string;
	readonly metadata?: TransactionMetadata;
	readonly entries: readonly Entry[];
	readonly postedAt?: DateTime;
	readonly created: DateTime;
	readonly updated: DateTime;
};

type TransactionCreateOptions = Omit<TransactionOptions, "postedAt" | "status"> &
	(
		| { readonly status: "pending"; readonly postedAt?: undefined }
		| { readonly status: "posted"; readonly postedAt: DateTime }
	);

type TransactionReplacement = Pick<TransactionOptions, "description" | "entries" | "metadata">;

type AccountCounterDelta = Readonly<{
	accountId: LedgerAccountID;
	pendingCredits: number;
	pendingDebits: number;
	postedCredits: number;
	postedDebits: number;
}>;

type TransactionMutation = Readonly<{
	transaction: Transaction;
	deltas: readonly AccountCounterDelta[];
}>;

const validationFailure = (message: string): TransactionValidationFailure =>
	new TransactionValidationFailure(message);

const validateMetadata = (
	metadata: TransactionMetadata | undefined
): TransactionMetadata | undefined => {
	if (metadata === undefined) return undefined;
	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
		throw validationFailure("Transaction metadata must be an object");
	}
	if (!Object.values(metadata).every(value => typeof value === "string")) {
		throw validationFailure("Transaction metadata values must be strings");
	}
	return Object.freeze({ ...metadata });
};

const validateDateTime = (value: DateTime, name: string): DateTime => {
	if (!DateTime.isDateTime(value) || !value.isValid) {
		throw validationFailure(`${name} must be a valid DateTime`);
	}
	return value;
};

const addSafeInteger = (left: number, right: number, message: string): number => {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw validationFailure(message);
	return result;
};

const validateEntries = (entries: readonly Entry[]): readonly Entry[] => {
	if (entries.length < 2) {
		throw validationFailure("Transaction must have at least two Entries");
	}

	const totals = new Map<string, Map<number, { debits: number; credits: number }>>();
	for (const entry of entries) {
		let byExponent = totals.get(entry.currency.code);
		if (byExponent === undefined) {
			byExponent = new Map();
			totals.set(entry.currency.code, byExponent);
		}
		const total = byExponent.get(entry.currency.minorUnitExponent) ?? {
			debits: 0,
			credits: 0,
		};
		if (entry.direction === "debit") {
			total.debits = addSafeInteger(
				total.debits,
				entry.amount,
				"Transaction Debit total exceeds the safe-integer range"
			);
		} else {
			total.credits = addSafeInteger(
				total.credits,
				entry.amount,
				"Transaction Credit total exceeds the safe-integer range"
			);
		}
		byExponent.set(entry.currency.minorUnitExponent, total);
	}

	for (const [code, byExponent] of totals) {
		for (const [minorUnitExponent, total] of byExponent) {
			if (total.debits !== total.credits) {
				throw validationFailure(`Transaction Entries must balance for ${code}/${minorUnitExponent}`);
			}
		}
	}

	return Object.freeze([...entries]);
};

type MutableCounterDelta = {
	accountId: LedgerAccountID;
	pendingCredits: number;
	pendingDebits: number;
	postedCredits: number;
	postedDebits: number;
};

const aggregateCounterDeltas = (
	contributions: readonly Readonly<{
		entries: readonly Entry[];
		pendingMultiplier: -1 | 0 | 1;
		postedMultiplier: -1 | 0 | 1;
	}>[]
): readonly AccountCounterDelta[] => {
	const byAccount = new Map<string, MutableCounterDelta>();
	for (const contribution of contributions) {
		for (const entry of contribution.entries) {
			const key = entry.accountId.toString();
			const delta = byAccount.get(key) ?? {
				accountId: entry.accountId,
				pendingCredits: 0,
				pendingDebits: 0,
				postedCredits: 0,
				postedDebits: 0,
			};
			const direction = entry.direction === "credit" ? "Credits" : "Debits";
			const pendingKey = `pending${direction}` as "pendingCredits" | "pendingDebits";
			const postedKey = `posted${direction}` as "postedCredits" | "postedDebits";
			delta[pendingKey] = addSafeInteger(
				delta[pendingKey],
				entry.amount * contribution.pendingMultiplier,
				"Pending Account counter delta exceeds the safe-integer range"
			);
			delta[postedKey] = addSafeInteger(
				delta[postedKey],
				entry.amount * contribution.postedMultiplier,
				"Posted Account counter delta exceeds the safe-integer range"
			);
			byAccount.set(key, delta);
		}
	}

	return Object.freeze(
		[...byAccount.values()]
			.sort((left, right) => left.accountId.toString().localeCompare(right.accountId.toString()))
			.map(delta => Object.freeze(delta))
	);
};

const mutation = (
	transaction: Transaction,
	deltas: readonly AccountCounterDelta[]
): TransactionMutation => Object.freeze({ transaction, deltas });

class Entry {
	readonly id: LedgerTransactionEntryID;
	readonly accountId: LedgerAccountID;
	readonly direction: EntryDirection;
	readonly amount: number;
	readonly currency: Currency;
	readonly metadata?: TransactionMetadata;

	private constructor(options: EntryOptions) {
		this.id = options.id;
		this.accountId = options.accountId;
		this.direction = options.direction;
		this.amount = options.amount;
		this.currency = options.currency;
		this.metadata = options.metadata;
	}

	static make(options: EntryOptions): Effect.Effect<Entry, TransactionValidationFailure> {
		return Effect.try({
			try: () => {
				if (options.direction !== "debit" && options.direction !== "credit") {
					throw validationFailure("Entry direction must be Debit or Credit");
				}
				if (!Number.isSafeInteger(options.amount) || options.amount <= 0) {
					throw validationFailure("Entry Amount must be a positive safe integer");
				}
				let currency: Currency;
				try {
					currency = makeCurrency(options.currency.code, options.currency.minorUnitExponent);
				} catch (error) {
					throw validationFailure(error instanceof Error ? error.message : "Entry Currency is invalid");
				}
				if (!currencyEquals(currency, options.currency)) {
					throw validationFailure("Entry Currency is invalid");
				}
				return new Entry({
					...options,
					currency,
					metadata: validateMetadata(options.metadata),
				});
			},
			catch: cause =>
				cause instanceof TransactionValidationFailure ? cause : validationFailure("Entry is invalid"),
		});
	}
}

class Transaction {
	readonly id: LedgerTransactionID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	readonly status: TransactionStatus;
	readonly description?: string;
	readonly metadata?: TransactionMetadata;
	readonly entries: readonly Entry[];
	readonly postedAt?: DateTime;
	readonly created: DateTime;
	readonly updated: DateTime;

	private constructor(options: TransactionOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.status = options.status;
		this.description = options.description;
		this.metadata = options.metadata;
		this.entries = options.entries;
		this.postedAt = options.postedAt;
		this.created = options.created;
		this.updated = options.updated;
	}

	static make(
		options: TransactionOptions
	): Effect.Effect<Transaction, TransactionValidationFailure> {
		return Effect.try({
			try: () => {
				if (
					options.status !== "pending" &&
					options.status !== "posted" &&
					options.status !== "voided"
				) {
					throw validationFailure("Transaction status is invalid");
				}
				if (options.status === "posted" && options.postedAt === undefined) {
					throw validationFailure("Posted Transaction requires Posted Time");
				}
				if (options.status !== "posted" && options.postedAt !== undefined) {
					throw validationFailure("Only a Posted Transaction may have Posted Time");
				}
				const entries = validateEntries(options.entries);
				// A Transaction whose Entries balance can still overflow one Account's counters.
				aggregateCounterDeltas([{ entries, pendingMultiplier: 1, postedMultiplier: 1 }]);
				return new Transaction({
					...options,
					metadata: validateMetadata(options.metadata),
					entries,
					postedAt:
						options.postedAt === undefined
							? undefined
							: validateDateTime(options.postedAt, "Posted Time"),
					created: validateDateTime(options.created, "Created Time"),
					updated: validateDateTime(options.updated, "Updated Time"),
				});
			},
			catch: cause =>
				cause instanceof TransactionValidationFailure
					? cause
					: validationFailure("Transaction is invalid"),
		});
	}

	static create(
		options: TransactionCreateOptions
	): Effect.Effect<TransactionMutation, TransactionValidationFailure> {
		return Transaction.make(options).pipe(
			Effect.map(transaction =>
				mutation(
					transaction,
					aggregateCounterDeltas([
						{
							entries: transaction.entries,
							pendingMultiplier: 1,
							postedMultiplier: transaction.status === "posted" ? 1 : 0,
						},
					])
				)
			)
		);
	}

	replace(
		replacement: TransactionReplacement,
		updated: DateTime
	): Effect.Effect<
		TransactionMutation,
		TransactionLifecycleConflict | TransactionValidationFailure
	> {
		if (this.status !== "pending") {
			return Effect.fail(
				new TransactionLifecycleConflict(this.id.toString(), this.status, "pending", this.errorContext)
			);
		}

		return Transaction.make({
			id: this.id,
			organizationId: this.organizationId,
			ledgerId: this.ledgerId,
			status: "pending",
			description: replacement.description,
			metadata: replacement.metadata,
			entries: replacement.entries,
			postedAt: undefined,
			created: this.created,
			updated,
		}).pipe(
			Effect.map(transaction =>
				mutation(
					transaction,
					aggregateCounterDeltas([
						{ entries: this.entries, pendingMultiplier: -1, postedMultiplier: 0 },
						{ entries: transaction.entries, pendingMultiplier: 1, postedMultiplier: 0 },
					])
				)
			)
		);
	}

	post(
		postedAt: DateTime
	): Effect.Effect<
		TransactionMutation,
		TransactionLifecycleConflict | TransactionValidationFailure
	> {
		if (this.status === "posted") return Effect.succeed(mutation(this, Object.freeze([])));
		if (this.status !== "pending") {
			return Effect.fail(
				new TransactionLifecycleConflict(this.id.toString(), this.status, "posted", this.errorContext)
			);
		}

		return Transaction.make({ ...this, status: "posted", postedAt, updated: postedAt }).pipe(
			Effect.map(transaction =>
				mutation(
					transaction,
					aggregateCounterDeltas([{ entries: this.entries, pendingMultiplier: 0, postedMultiplier: 1 }])
				)
			)
		);
	}

	void(
		updated: DateTime
	): Effect.Effect<
		TransactionMutation,
		TransactionLifecycleConflict | TransactionValidationFailure
	> {
		if (this.status === "voided") return Effect.succeed(mutation(this, Object.freeze([])));
		if (this.status !== "pending") {
			return Effect.fail(
				new TransactionLifecycleConflict(this.id.toString(), this.status, "voided", this.errorContext)
			);
		}

		return Transaction.make({ ...this, status: "voided", updated }).pipe(
			Effect.map(transaction =>
				mutation(
					transaction,
					aggregateCounterDeltas([{ entries: this.entries, pendingMultiplier: -1, postedMultiplier: 0 }])
				)
			)
		);
	}

	private get errorContext() {
		return {
			organizationId: this.organizationId.toString(),
			ledgerId: this.ledgerId.toString(),
			transactionId: this.id.toString(),
		};
	}
}

export type {
	AccountCounterDelta,
	EntryDirection,
	EntryOptions,
	TransactionCreateOptions,
	TransactionMetadata,
	TransactionMutation,
	TransactionOptions,
	TransactionReplacement,
	TransactionStatus,
};
export { Entry, Transaction };
