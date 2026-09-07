import { Effect, Option } from "effect";
import { DateTime } from "luxon";

import type { Metadata } from "@/lib/schema";
import { encodeUuid, encodeMetadata, parseDate, parseUuid, parseMetadata } from "@/lib/utils";
import type {
	LedgerAccountSettlementID,
	LedgerID,
	LedgerTransactionEntryID,
	LedgerTransactionID,
	OrgID,
} from "@/lib/ids";
import type {
	LedgerTransactionInsertRow,
	LedgerTransactionRow,
	LedgerTransactionWithEntriesRow,
} from "@/db/schema";

import {
	TransactionLifecycleConflict,
	TransactionPersistenceDecodingFailure,
	TransactionValidationFailure,
} from "./LedgerTransactionErrors";
import type {
	TransactionCreateRequest as LedgerTransactionCreateRequest,
	TransactionListItemResponse,
	TransactionResponse,
	TransactionUpdateRequest as LedgerTransactionUpdateRequest,
} from "./LedgerTransactionSchema";
import { LedgerTransactionEntry } from "./LedgerTransactionEntry";

type LedgerTransactionStatus = "pending" | "posted" | "voided";
type LedgerTransactionOptions = Readonly<{
	id: LedgerTransactionID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	/** Owning Settlement for generated accounting; absent for ordinary Transactions. */
	settlementId?: LedgerAccountSettlementID;
	status: LedgerTransactionStatus;
	description?: string;
	metadata?: Metadata;
	entries: Option.Option<readonly LedgerTransactionEntry[]>;
	postedAt?: DateTime;
	effectiveAt: DateTime;
	lockVersion: number;
	created: DateTime;
	updated: DateTime;
}>;

const toIso = (value: DateTime): string => {
	const encoded = value.toISO();
	if (encoded === null) throw new Error("Transaction contains an invalid timestamp");
	return encoded;
};

/**
 * A balanced collection of Ledger Entries that share one lifecycle.
 *
 * The entity owns transformations and invariants but performs no I/O.
 */
class LedgerTransaction {
	readonly id: LedgerTransactionID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	/** Owning Settlement, whose lifecycle controls mutations of this accounting. */
	readonly settlementId?: LedgerAccountSettlementID;
	readonly status: LedgerTransactionStatus;
	readonly description?: string;
	readonly metadata?: Metadata;
	readonly entries: Option.Option<readonly LedgerTransactionEntry[]>;
	readonly postedAt?: DateTime;
	readonly effectiveAt: DateTime;
	readonly lockVersion: number;
	readonly created: DateTime;
	readonly updated: DateTime;

	private constructor(options: LedgerTransactionOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.settlementId = options.settlementId;
		this.status = options.status;
		this.description = options.description;
		this.metadata = options.metadata;
		this.entries = options.entries;
		this.postedAt = options.postedAt;
		this.effectiveAt = options.effectiveAt;
		this.lockVersion = options.lockVersion;
		this.created = options.created;
		this.updated = options.updated;
	}

	static create(
		options: LedgerTransactionOptions
	): Effect.Effect<LedgerTransaction, TransactionValidationFailure> {
		return LedgerTransaction.validateBalanced(Option.getOrThrow(options.entries)).pipe(
			// oxlint-disable-next-line unicorn/no-array-callback-reference -- The array is wrapped as an Option value.
			Effect.map(entries => new LedgerTransaction({ ...options, entries: Option.some(entries) }))
		);
	}

	/**
	 * Creates a new Transaction and its Entries from a validated API request.
	 *
	 * @param id - Generated Transaction identifier.
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param request - TypeBox-validated creation request.
	 * @param created - Creation time; defaults to the current UTC time and may be supplied by tests.
	 * @returns An Effect containing the balanced Transaction or a validation failure.
	 */
	static fromCreateRequest(
		id: LedgerTransactionID,
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerTransactionCreateRequest,
		created: DateTime = DateTime.utc(),
		entryIds?: readonly LedgerTransactionEntryID[]
	): Effect.Effect<LedgerTransaction, TransactionValidationFailure> {
		return Effect.all(
			request.ledgerEntries.map((entry, index) =>
				LedgerTransactionEntry.fromRequest(entry, request.status, created, entryIds?.[index])
			)
		).pipe(
			Effect.flatMap(entries => LedgerTransaction.validateBalanced(entries)),
			Effect.map(
				entries =>
					new LedgerTransaction({
						id,
						organizationId,
						ledgerId,
						status: request.status,
						description: request.description,
						metadata: request.metadata,
						// oxlint-disable-next-line unicorn/no-array-callback-reference
						entries: Option.some(entries),
						postedAt: request.status === "posted" ? created : undefined,
						effectiveAt:
							request.effectiveAt === undefined
								? created
								: DateTime.fromISO(request.effectiveAt, { zone: "utc" }),
						lockVersion: 1,
						created,
						updated: created,
					})
			)
		);
	}

	/**
	 * Replaces the mutable fields and Entries of a pending Transaction.
	 *
	 * @param request - TypeBox-validated update request.
	 * @param updated - Update time; defaults to the current UTC time and may be supplied by tests.
	 * @returns An Effect containing the replacement or a lifecycle or balance failure.
	 */
	fromUpdateRequest(
		request: LedgerTransactionUpdateRequest,
		updated: DateTime = DateTime.utc(),
		entryIds?: readonly LedgerTransactionEntryID[]
	): Effect.Effect<LedgerTransaction, TransactionLifecycleConflict | TransactionValidationFailure> {
		if (this.status !== "pending") {
			return Effect.fail(new TransactionLifecycleConflict(this.status, "pending"));
		}

		return Effect.all(
			request.ledgerEntries.map((entry, index) =>
				LedgerTransactionEntry.fromRequest(entry, "pending", updated, entryIds?.[index])
			)
		).pipe(
			Effect.flatMap(entries => LedgerTransaction.validateBalanced(entries)),
			Effect.map(
				entries =>
					new LedgerTransaction({
						...this,
						effectiveAt:
							request.effectiveAt === undefined
								? this.effectiveAt
								: DateTime.fromISO(request.effectiveAt, { zone: "utc" }),
						description: request.description,
						metadata: request.metadata,
						// oxlint-disable-next-line unicorn/no-array-callback-reference
						entries: Option.some(entries),
						lockVersion: this.lockVersion + 1,
						updated,
					})
			)
		);
	}

	/**
	 * Hydrates a Transaction without loading its Entries.
	 *
	 * @param row - Transaction row inferred from the Drizzle schema.
	 * @returns An Effect containing the Transaction or a persistence decoding failure.
	 */
	static fromRow(
		row: LedgerTransactionRow
	): Effect.Effect<LedgerTransaction, TransactionPersistenceDecodingFailure> {
		return LedgerTransaction.decode(row, Option.none()).pipe(
			Effect.map(options => new LedgerTransaction(options)),
			Effect.mapError(cause => new TransactionPersistenceDecodingFailure(cause))
		);
	}

	/**
	 * Hydrates a Transaction and its Entries from a Drizzle relational result.
	 *
	 * @param rows - Schema-inferred Transaction rows with their Entry relation.
	 * @returns An Effect containing no Transaction, or the first hydrated Transaction.
	 */
	static fromRows(
		rows: readonly LedgerTransactionWithEntriesRow[]
	): Effect.Effect<Option.Option<LedgerTransaction>, TransactionPersistenceDecodingFailure> {
		const first = rows[0];
		if (first === undefined) return Effect.succeed(Option.none());

		return Effect.all(first.entries.map(entry => LedgerTransactionEntry.fromRow(entry))).pipe(
			Effect.flatMap(entries =>
				// oxlint-disable-next-line unicorn/no-array-callback-reference
				LedgerTransaction.decode(first, Option.some(entries))
			),
			// oxlint-disable-next-line unicorn/no-array-callback-reference
			Effect.map(options => Option.some(new LedgerTransaction(options))),
			Effect.mapError(cause => new TransactionPersistenceDecodingFailure(cause))
		);
	}

	/** @returns The Transaction's Drizzle persistence representation. */
	toRow(): LedgerTransactionInsertRow {
		return {
			id: encodeUuid(this.id),
			organizationId: encodeUuid(this.organizationId),
			ledgerId: encodeUuid(this.ledgerId),
			// oxlint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			settlementId: this.settlementId ? encodeUuid(this.settlementId) : null,
			status: this.status,
			// oxlint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.description ?? null,
			metadata: encodeMetadata(this.metadata),
			// oxlint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			postedAt: this.postedAt?.toJSDate() ?? null,
			effectiveAt: this.effectiveAt.toJSDate(),
			lockVersion: this.lockVersion,
			created: this.created.toJSDate(),
			updated: this.updated.toJSDate(),
		};
	}

	toListItemResponse(): TransactionListItemResponse {
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			...(this.description === undefined ? {} : { description: this.description }),
			status: this.status,
			...(this.metadata === undefined ? {} : { metadata: this.metadata }),
			...(this.postedAt === undefined ? {} : { postedAt: toIso(this.postedAt) }),
			effectiveAt: toIso(this.effectiveAt),
			created: toIso(this.created),
			updated: toIso(this.updated),
		};
	}

	toResponse(): TransactionResponse {
		return {
			...this.toListItemResponse(),
			ledgerEntries: Option.getOrThrow(this.entries).map(entry => entry.toResponse()),
		};
	}

	/**
	 * Transitions a pending Transaction and all its Entries to posted.
	 *
	 * @param postedAt - Posting time; defaults to the current UTC time and may be supplied by tests.
	 * @returns An Effect containing the posted Transaction or a lifecycle conflict.
	 */
	toPosted(
		postedAt: DateTime = DateTime.utc()
	): Effect.Effect<LedgerTransaction, TransactionLifecycleConflict> {
		if (this.status === "posted") return Effect.succeed(this);
		if (this.status !== "pending") {
			return Effect.fail(new TransactionLifecycleConflict(this.status, "posted"));
		}

		return Effect.succeed(
			new LedgerTransaction({
				...this,
				status: "posted",
				// oxlint-disable-next-line unicorn/no-array-callback-reference
				entries: Option.map(this.entries, entries => entries.map(entry => entry.toPosted())),
				postedAt,
				lockVersion: this.lockVersion + 1,
				updated: postedAt,
			})
		);
	}

	/**
	 * Transitions a pending Transaction and all its Entries to voided.
	 *
	 * @param updated - Void time; defaults to the current UTC time and may be supplied by tests.
	 * @returns An Effect containing the voided Transaction or a lifecycle conflict.
	 */
	toVoided(
		updated: DateTime = DateTime.utc()
	): Effect.Effect<LedgerTransaction, TransactionLifecycleConflict> {
		if (this.status === "voided") return Effect.succeed(this);
		if (this.status !== "pending") {
			return Effect.fail(new TransactionLifecycleConflict(this.status, "voided"));
		}

		return Effect.succeed(
			new LedgerTransaction({
				...this,
				status: "voided",
				// oxlint-disable-next-line unicorn/no-array-callback-reference
				entries: Option.map(this.entries, entries => entries.map(entry => entry.toVoided())),
				lockVersion: this.lockVersion + 1,
				updated,
			})
		);
	}

	private static decode(
		row: LedgerTransactionRow,
		entries: Option.Option<readonly LedgerTransactionEntry[]>
	): Effect.Effect<LedgerTransactionOptions, Error> {
		return Effect.all({
			id: parseUuid<"ltr", LedgerTransactionID>("ltr", row.id),
			organizationId: parseUuid<"org", OrgID>("org", row.organizationId),
			ledgerId: parseUuid<"lgr", LedgerID>("lgr", row.ledgerId),
			settlementId:
				row.settlementId === null
					? Effect.succeed(undefined)
					: parseUuid<"las", LedgerAccountSettlementID>("las", row.settlementId),
			metadata: parseMetadata(row.metadata),
			postedAt: row.postedAt === null ? Effect.succeed(undefined) : parseDate(row.postedAt),
			effectiveAt: parseDate(row.effectiveAt),
			created: parseDate(row.created),
			updated: parseDate(row.updated),
		}).pipe(
			Effect.map(decoded => ({
				...decoded,
				status: row.status,
				description: row.description ?? undefined,
				entries,
				lockVersion: row.lockVersion,
			}))
		);
	}

	private static validateBalanced(
		entries: readonly LedgerTransactionEntry[]
	): Effect.Effect<readonly LedgerTransactionEntry[], TransactionValidationFailure> {
		const totals = new Map<string, bigint>();

		for (const entry of entries) {
			const amount = BigInt(entry.amount);
			const total = totals.get(entry.currency) ?? 0n;
			totals.set(entry.currency, total + (entry.direction === "debit" ? amount : -amount));
		}

		return [...totals.values()].some(total => total !== 0n)
			? Effect.fail(new TransactionValidationFailure("Transaction Entries must balance by Currency"))
			: Effect.succeed(entries);
	}
}

export type { LedgerTransactionOptions, LedgerTransactionStatus };
export { LedgerTransaction };
