import { Effect, Option } from "effect";
import { DateTime } from "luxon";

import { BadRequestError } from "@/lib/errors";
import { encodeMetadata, parseDate, parseId, parseMetadata } from "@/lib/utils";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import type {
	LedgerAccountInsertRow,
	LedgerAccountRow,
	LedgerTransactionEntryRow,
} from "@/repo/schema";

import { AccountPersistenceDecodingFailure } from "./AccountErrors";
import type {
	AccountCreateRequest as LedgerAccountCreateRequest,
	AccountResponse,
	AccountUpdateRequest as LedgerAccountUpdateRequest,
} from "./AccountSchema";

type LedgerAccountMetadata = Readonly<Record<string, string>>;
type LedgerAccountEntry = Pick<
	LedgerTransactionEntryRow,
	"amount" | "currency" | "direction" | "status"
>;

type LedgerAccountOptions = Readonly<{
	id: LedgerAccountID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	name: string;
	description?: string;
	normalBalance: "debit" | "credit";
	currency: string;
	pendingAmount: number;
	postedAmount: number;
	availableAmount: number;
	pendingCredits: number;
	pendingDebits: number;
	postedCredits: number;
	postedDebits: number;
	availableCredits: number;
	availableDebits: number;
	lockVersion: number;
	metadata?: LedgerAccountMetadata;
	created: DateTime;
	updated: DateTime;
}>;

type LedgerAccountBalance = Readonly<{
	balanceType: "pending" | "posted" | "availableBalance";
	credits: number;
	debits: number;
	amount: number;
}>;

const toIso = (value: DateTime): string => {
	const encoded = value.toISO();
	if (encoded === null) throw new Error("Account contains an invalid timestamp");
	return encoded;
};

class LedgerAccountCurrencyMismatch extends BadRequestError {
	constructor(accountCurrency: string, entryCurrency: string) {
		super(`Entry Currency ${entryCurrency} does not match Account Currency ${accountCurrency}`);
	}
}

/**
 * A Ledger Account and its persisted pending, posted, and available Balances.
 *
 * The entity owns balance changes but performs no I/O.
 */
class LedgerAccount {
	readonly id: LedgerAccountID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	readonly name: string;
	readonly description?: string;
	readonly normalBalance: LedgerAccountOptions["normalBalance"];
	readonly currency: string;
	readonly pendingAmount: number;
	readonly postedAmount: number;
	readonly availableAmount: number;
	readonly pendingCredits: number;
	readonly pendingDebits: number;
	readonly postedCredits: number;
	readonly postedDebits: number;
	readonly availableCredits: number;
	readonly availableDebits: number;
	readonly lockVersion: number;
	readonly metadata?: LedgerAccountMetadata;
	readonly created: DateTime;
	readonly updated: DateTime;

	private constructor(options: LedgerAccountOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.name = options.name;
		this.description = options.description;
		this.normalBalance = options.normalBalance;
		this.currency = options.currency;
		this.pendingAmount = options.pendingAmount;
		this.postedAmount = options.postedAmount;
		this.availableAmount = options.availableAmount;
		this.pendingCredits = options.pendingCredits;
		this.pendingDebits = options.pendingDebits;
		this.postedCredits = options.postedCredits;
		this.postedDebits = options.postedDebits;
		this.availableCredits = options.availableCredits;
		this.availableDebits = options.availableDebits;
		this.lockVersion = options.lockVersion;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	/**
	 * Creates an Account from a validated API request.
	 *
	 * @param id - Generated Account identifier.
	 * @param organizationId - Organization that owns the Account.
	 * @param ledgerId - Ledger that contains the Account.
	 * @param request - TypeBox-validated creation request.
	 * @param created - Account creation time, defaulting to the current UTC time.
	 * @returns The new Account with every Balance initialized to zero.
	 */
	static fromCreateRequest(
		id: LedgerAccountID,
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerAccountCreateRequest,
		created = DateTime.utc()
	): LedgerAccount {
		return new LedgerAccount({
			id,
			organizationId,
			ledgerId,
			name: request.name,
			description: request.description,
			normalBalance: request.normalBalance,
			currency: request.currencyCode,
			pendingAmount: 0,
			postedAmount: 0,
			availableAmount: 0,
			pendingCredits: 0,
			pendingDebits: 0,
			postedCredits: 0,
			postedDebits: 0,
			availableCredits: 0,
			availableDebits: 0,
			lockVersion: 1,
			metadata: request.metadata,
			created,
			updated: created,
		});
	}

	/**
	 * Replaces the mutable Account fields from a validated API request.
	 *
	 * @param request - TypeBox-validated update request.
	 * @param updated - Account update time, defaulting to the current UTC time.
	 * @returns The updated Account with its Balance and lock version unchanged.
	 */
	fromUpdateRequest(request: LedgerAccountUpdateRequest, updated = DateTime.utc()): LedgerAccount {
		return new LedgerAccount({
			...this,
			name: request.name,
			description: request.description,
			metadata: request.metadata,
			updated,
		});
	}

	/**
	 * Hydrates an Account from its Drizzle row.
	 *
	 * @param row - Account row inferred from the Drizzle schema, or no row.
	 * @returns An Effect containing no Account, the hydrated Account, or a decoding failure.
	 */
	static fromRow(
		row: LedgerAccountRow | undefined
	): Effect.Effect<Option.Option<LedgerAccount>, AccountPersistenceDecodingFailure> {
		if (row === undefined) return Effect.succeed(Option.none());

		return Effect.all({
			id: parseId<"lat", LedgerAccountID>("lat", row.id),
			organizationId: parseId<"org", OrgID>("org", row.organizationId),
			ledgerId: parseId<"lgr", LedgerID>("lgr", row.ledgerId),
			metadata: parseMetadata(row.metadata),
			created: parseDate(row.created),
			updated: parseDate(row.updated),
		}).pipe(
			Effect.map(decoded =>
				Option.some(
					// oxlint-disable-next-line unicorn/no-array-callback-reference -- Constructor receives decoded values.
					new LedgerAccount({
						...decoded,
						name: row.name,
						description: row.description ?? undefined,
						normalBalance: row.normalBalance,
						currency: row.currencyCode,
						pendingAmount: row.pendingAmount,
						postedAmount: row.postedAmount,
						availableAmount: row.availableAmount,
						pendingCredits: row.pendingCredits,
						pendingDebits: row.pendingDebits,
						postedCredits: row.postedCredits,
						postedDebits: row.postedDebits,
						availableCredits: row.availableCredits,
						availableDebits: row.availableDebits,
						lockVersion: row.lockVersion,
					})
				)
			),
			Effect.mapError(cause => new AccountPersistenceDecodingFailure(cause))
		);
	}

	/**
	 * Converts the Account to its Drizzle persistence representation.
	 *
	 * @returns The complete Account row, including all stored Balance fields.
	 */
	toRow(): LedgerAccountInsertRow {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			ledgerId: this.ledgerId.toString(),
			name: this.name,
			description: this.description,
			normalBalance: this.normalBalance,
			currencyCode: this.currency,
			pendingAmount: this.pendingAmount,
			postedAmount: this.postedAmount,
			availableAmount: this.availableAmount,
			pendingCredits: this.pendingCredits,
			pendingDebits: this.pendingDebits,
			postedCredits: this.postedCredits,
			postedDebits: this.postedDebits,
			availableCredits: this.availableCredits,
			availableDebits: this.availableDebits,
			lockVersion: this.lockVersion,
			metadata: encodeMetadata(this.metadata),
			created: this.created.toJSDate(),
			updated: this.updated.toJSDate(),
		};
	}

	toResponse(): AccountResponse {
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			name: this.name,
			...(this.description === undefined ? {} : { description: this.description }),
			normalBalance: this.normalBalance,
			currencyCode: this.currency,
			balances: this.balances.map(balance => ({ ...balance })),
			...(this.metadata === undefined ? {} : { metadata: this.metadata }),
			lockVersion: this.lockVersion,
			created: toIso(this.created),
			updated: toIso(this.updated),
		};
	}

	/**
	 * Records one Entry in the Account's stored Balances.
	 *
	 * @param entry - Entry whose status and direction determine the affected Balances.
	 * @param updated - Account update time, defaulting to the current UTC time.
	 * @returns An Effect containing the updated Account or a Currency mismatch.
	 */
	record(
		entry: LedgerAccountEntry,
		updated = DateTime.utc()
	): Effect.Effect<LedgerAccount, LedgerAccountCurrencyMismatch> {
		if (entry.currency !== this.currency) {
			return Effect.fail(new LedgerAccountCurrencyMismatch(this.currency, entry.currency));
		}

		return Effect.succeed(this.applyEntry(entry, "record", updated));
	}

	/**
	 * Removes one Entry from the Account's stored Balances.
	 *
	 * @param entry - Previously recorded Entry to remove.
	 * @param updated - Account update time, defaulting to the current UTC time.
	 * @returns The Account with the Entry's Balance effects removed.
	 */
	remove(entry: LedgerAccountEntry, updated = DateTime.utc()): LedgerAccount {
		return this.applyEntry(entry, "remove", updated);
	}

	/** @returns The pending, posted, and available Balances stored on the Account. */
	get balances(): readonly LedgerAccountBalance[] {
		return [
			{
				balanceType: "pending",
				credits: this.pendingCredits,
				debits: this.pendingDebits,
				amount: this.pendingAmount,
			},
			{
				balanceType: "posted",
				credits: this.postedCredits,
				debits: this.postedDebits,
				amount: this.postedAmount,
			},
			{
				balanceType: "availableBalance",
				credits: this.availableCredits,
				debits: this.availableDebits,
				amount: this.availableAmount,
			},
		];
	}

	private applyEntry(
		entry: LedgerAccountEntry,
		operation: "record" | "remove",
		updated: DateTime
	): LedgerAccount {
		if (entry.status === "voided") return this;

		const amount = operation === "record" ? entry.amount : -entry.amount;
		const balanceAmount = entry.direction === this.normalBalance ? amount : -amount;
		const posted = entry.status === "posted";
		const available = posted || entry.direction !== this.normalBalance;

		return new LedgerAccount({
			...this,
			pendingAmount: this.pendingAmount + balanceAmount,
			postedAmount: this.postedAmount + (posted ? balanceAmount : 0),
			availableAmount: this.availableAmount + (available ? balanceAmount : 0),
			pendingCredits: this.pendingCredits + (entry.direction === "credit" ? amount : 0),
			pendingDebits: this.pendingDebits + (entry.direction === "debit" ? amount : 0),
			postedCredits: this.postedCredits + (posted && entry.direction === "credit" ? amount : 0),
			postedDebits: this.postedDebits + (posted && entry.direction === "debit" ? amount : 0),
			availableCredits:
				this.availableCredits + (available && entry.direction === "credit" ? amount : 0),
			availableDebits: this.availableDebits + (available && entry.direction === "debit" ? amount : 0),
			updated,
		});
	}
}

export type { LedgerAccountBalance, LedgerAccountMetadata, LedgerAccountOptions };
export { LedgerAccount, LedgerAccountCurrencyMismatch };
