import { TypeID } from "typeid-js";
import { Effect, Option } from "effect";
import { DateTime } from "luxon";

import type { AssetSummary } from "@/lib/AssetSchema";
import { assertInt64 } from "@/lib/amounts";
import { BadRequestError } from "@/lib/errors";
import type { Metadata } from "@/lib/schema";
import { encodeUuid, encodeMetadata, parseDate, parseUuid, parseMetadata } from "@/lib/utils";
import type { LedgerAccountID, LedgerID, OrgID } from "@/lib/ids";
import type {
	LedgerAccountInsertRow,
	LedgerAccountRow,
	LedgerTransactionEntryRow,
} from "@/db/schema";

import { AccountPersistenceDecodingFailure } from "./AccountErrors";
import type {
	AccountCreateRequest as LedgerAccountCreateRequest,
	AccountResponse,
	AccountUpdateRequest as LedgerAccountUpdateRequest,
} from "./AccountSchema";

type LedgerAccountEntry = Pick<
	LedgerTransactionEntryRow,
	"amount" | "assetId" | "direction" | "status"
>;

type LedgerAccountOptions = Readonly<{
	id: LedgerAccountID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	name: string;
	description?: string;
	normalBalance: "debit" | "credit";
	assetId: string;
	assetCode: string;
	minorUnitExponent: number;
	pendingAmount: bigint;
	postedAmount: bigint;
	availableAmount: bigint;
	pendingCredits: bigint;
	pendingDebits: bigint;
	postedCredits: bigint;
	postedDebits: bigint;
	availableCredits: bigint;
	availableDebits: bigint;
	lockVersion: number;
	metadata?: Metadata;
	created: DateTime;
	updated: DateTime;
}>;

type LedgerAccountBalance = Readonly<{
	balanceType: "pending" | "posted" | "availableBalance";
	credits: bigint;
	debits: bigint;
	amount: bigint;
}>;

const toIso = (value: DateTime): string => {
	const encoded = value.toISO();
	if (encoded === null) throw new Error("Account contains an invalid timestamp");
	return encoded;
};

class LedgerAccountAssetMismatch extends BadRequestError {
	constructor(accountAssetId: string, entryAssetId: string) {
		super(`Entry Asset ${entryAssetId} does not match Account Asset ${accountAssetId}`);
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
	readonly assetId: string;
	readonly assetCode: string;
	readonly minorUnitExponent: number;
	readonly pendingAmount: bigint;
	readonly postedAmount: bigint;
	readonly availableAmount: bigint;
	readonly pendingCredits: bigint;
	readonly pendingDebits: bigint;
	readonly postedCredits: bigint;
	readonly postedDebits: bigint;
	readonly availableCredits: bigint;
	readonly availableDebits: bigint;
	readonly lockVersion: number;
	readonly metadata?: Metadata;
	readonly created: DateTime;
	readonly updated: DateTime;

	private constructor(options: LedgerAccountOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.name = options.name;
		this.description = options.description;
		this.normalBalance = options.normalBalance;
		this.assetId = options.assetId;
		this.assetCode = options.assetCode;
		this.minorUnitExponent = options.minorUnitExponent;
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
	 * @param asset - Resolved Asset identity and current display attributes.
	 * @param created - Account creation time, defaulting to the current UTC time.
	 * @returns The new Account with every Balance initialized to zero.
	 */
	static fromCreateRequest(
		id: LedgerAccountID,
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerAccountCreateRequest,
		asset: AssetSummary,
		created = DateTime.utc()
	): LedgerAccount {
		return new LedgerAccount({
			id,
			organizationId,
			ledgerId,
			name: request.name,
			description: request.description,
			normalBalance: request.normalBalance,
			assetId: asset.assetId,
			assetCode: asset.assetCode,
			minorUnitExponent: asset.minorUnitExponent,
			pendingAmount: 0n,
			postedAmount: 0n,
			availableAmount: 0n,
			pendingCredits: 0n,
			pendingDebits: 0n,
			postedCredits: 0n,
			postedDebits: 0n,
			availableCredits: 0n,
			availableDebits: 0n,
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
	 * @param asset - Current attributes of the Account's Asset.
	 * @returns An Effect containing no Account, the hydrated Account, or a decoding failure.
	 */
	static fromRow(
		row: LedgerAccountRow | undefined,
		asset: AssetSummary
	): Effect.Effect<Option.Option<LedgerAccount>, AccountPersistenceDecodingFailure> {
		if (row === undefined) return Effect.succeed(Option.none());

		return Effect.all({
			id: parseUuid<"lat", LedgerAccountID>("lat", row.id),
			organizationId: parseUuid<"org", OrgID>("org", row.organizationId),
			ledgerId: parseUuid<"lgr", LedgerID>("lgr", row.ledgerId),
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
						assetCode: asset.assetCode,
						minorUnitExponent: asset.minorUnitExponent,
						assetId: TypeID.fromUUID("ast", row.assetId).toString(),
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
			id: encodeUuid(this.id),
			organizationId: encodeUuid(this.organizationId),
			ledgerId: encodeUuid(this.ledgerId),
			name: this.name,
			description: this.description,
			normalBalance: this.normalBalance,
			assetId: encodeUuid(TypeID.fromString(this.assetId)),
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
			assetId: this.assetId,
			assetCode: this.assetCode,
			minorUnitExponent: this.minorUnitExponent,
			balances: this.balances.map(balance => ({
				...balance,
				amount: balance.amount.toString(),
				credits: balance.credits.toString(),
				debits: balance.debits.toString(),
			})),
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
	 * @returns An Effect containing the updated Account or an Asset mismatch.
	 */
	record(
		entry: LedgerAccountEntry,
		updated = DateTime.utc()
	): Effect.Effect<LedgerAccount, LedgerAccountAssetMismatch> {
		if (entry.assetId !== this.assetId) {
			return Effect.fail(new LedgerAccountAssetMismatch(this.assetId, entry.assetId));
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
		if (entry.assetId !== this.assetId) {
			throw new LedgerAccountAssetMismatch(this.assetId, entry.assetId);
		}
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

	/** Validates final projections immediately before the complete mutation is persisted. */
	assertBalancesInRange(): void {
		for (const balance of this.balances) {
			assertInt64(balance.amount);
			assertInt64(balance.credits);
			assertInt64(balance.debits);
		}
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
			postedAmount: this.postedAmount + (posted ? balanceAmount : 0n),
			availableAmount: this.availableAmount + (available ? balanceAmount : 0n),
			pendingCredits: this.pendingCredits + (entry.direction === "credit" ? amount : 0n),
			pendingDebits: this.pendingDebits + (entry.direction === "debit" ? amount : 0n),
			postedCredits: this.postedCredits + (posted && entry.direction === "credit" ? amount : 0n),
			postedDebits: this.postedDebits + (posted && entry.direction === "debit" ? amount : 0n),
			availableCredits:
				this.availableCredits + (available && entry.direction === "credit" ? amount : 0n),
			availableDebits: this.availableDebits + (available && entry.direction === "debit" ? amount : 0n),
			updated,
		});
	}
}

export type { LedgerAccountBalance, LedgerAccountOptions };
export { LedgerAccount, LedgerAccountAssetMismatch };
