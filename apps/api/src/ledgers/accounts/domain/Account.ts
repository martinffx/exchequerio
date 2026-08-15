import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import type { AccountCreateRow, AccountRow, AccountUpdateRow } from "@/repo/schema";
import { parseId } from "@/lib/utils";
import type { AccountCreateRequest, AccountUpdateRequest } from "../AccountSchema";
import { AccountPersistenceDecodingFailure } from "../AccountErrors";
import { makeCurrency, type Currency } from "./Currency";

type AccountMetadata = Readonly<Record<string, string>>;
type DerivedBalanceColumn =
	| "pendingAmount"
	| "postedAmount"
	| "availableAmount"
	| "availableCredits"
	| "availableDebits";
type AccountPersistenceRow = Omit<AccountRow, DerivedBalanceColumn>;
type AccountCreatePersistenceRow = Omit<AccountCreateRow, DerivedBalanceColumn>;

type AccountOptions = {
	readonly id: LedgerAccountID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	readonly name: string;
	readonly description?: string;
	readonly normalBalance: "debit" | "credit";
	readonly currency: Currency;
	readonly pendingCredits: number;
	readonly pendingDebits: number;
	readonly postedCredits: number;
	readonly postedDebits: number;
	readonly lockVersion: number;
	readonly metadata?: AccountMetadata;
	readonly created: DateTime;
	readonly updated: DateTime;
};

type AccountBalanceType = "pending" | "posted" | "availableBalance";
type AccountBalance = Readonly<{
	balanceType: AccountBalanceType;
	credits: number;
	debits: number;
	amount: number;
}>;

const decodeDate = (value: Date): DateTime => {
	const date = DateTime.fromJSDate(value, { zone: "utc" });
	if (!date.isValid) throw new Error("Invalid Account timestamp");
	return date;
};

const decodeMetadata = (value: string | null): AccountMetadata | undefined => {
	if (value === null) return undefined;
	const decoded: unknown = JSON.parse(value);
	if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
		throw new Error("Account metadata must be an object");
	}
	if (!Object.values(decoded).every(item => typeof item === "string")) {
		throw new Error("Account metadata values must be strings");
	}
	return decoded as Record<string, string>;
};

const decodeLockVersion = (value: number): number => {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error("Invalid Account lock version");
	}
	return value;
};

const decodeMinorUnits = (value: number): number => {
	if (!Number.isSafeInteger(value)) throw new Error("Invalid Account balance");
	return value;
};

class Account {
	readonly id: LedgerAccountID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	readonly name: string;
	readonly description?: string;
	readonly normalBalance: AccountOptions["normalBalance"];
	readonly currency: Currency;
	readonly pendingCredits: number;
	readonly pendingDebits: number;
	readonly postedCredits: number;
	readonly postedDebits: number;
	readonly lockVersion: number;
	readonly metadata?: AccountMetadata;
	readonly created: DateTime;
	readonly updated: DateTime;

	constructor(options: AccountOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.name = options.name;
		this.description = options.description;
		this.normalBalance = options.normalBalance;
		this.currency = options.currency;
		this.pendingCredits = options.pendingCredits;
		this.pendingDebits = options.pendingDebits;
		this.postedCredits = options.postedCredits;
		this.postedDebits = options.postedDebits;
		this.lockVersion = options.lockVersion;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	static fromRequest(
		id: LedgerAccountID,
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: AccountCreateRequest
	): Account {
		const now = DateTime.utc();
		const zero = 0;
		return new Account({
			id,
			organizationId,
			ledgerId,
			name: request.name,
			description: request.description,
			normalBalance: request.normalBalance,
			currency: makeCurrency(request.currencyCode, request.minorUnitExponent),
			pendingCredits: zero,
			pendingDebits: zero,
			postedCredits: zero,
			postedDebits: zero,
			lockVersion: 1,
			metadata: request.metadata,
			created: now,
			updated: now,
		});
	}

	static fromRow(
		row: AccountPersistenceRow | undefined
	): Effect.Effect<Option.Option<Account>, AccountPersistenceDecodingFailure> {
		if (row === undefined) return Effect.succeed(Option.none());

		return Effect.gen(function* () {
			const id = yield* parseId<"lat", LedgerAccountID>("lat", row.id);
			const organizationId = yield* parseId<"org", OrgID>("org", row.organizationId);
			const ledgerId = yield* parseId<"lgr", LedgerID>("lgr", row.ledgerId);
			const decoded = yield* Effect.try({
				try: () => ({
					currency: makeCurrency(row.currencyCode, row.minorUnitExponent),
					pendingCredits: decodeMinorUnits(row.pendingCredits),
					pendingDebits: decodeMinorUnits(row.pendingDebits),
					postedCredits: decodeMinorUnits(row.postedCredits),
					postedDebits: decodeMinorUnits(row.postedDebits),
					lockVersion: decodeLockVersion(row.lockVersion),
					metadata: decodeMetadata(row.metadata),
					created: decodeDate(row.created),
					updated: decodeDate(row.updated),
				}),
				catch: cause => cause,
			});
			const account = new Account({
				id,
				organizationId,
				ledgerId,
				name: row.name,
				description: row.description ?? undefined,
				normalBalance: row.normalBalance,
				currency: decoded.currency,
				pendingCredits: decoded.pendingCredits,
				pendingDebits: decoded.pendingDebits,
				postedCredits: decoded.postedCredits,
				postedDebits: decoded.postedDebits,
				lockVersion: decoded.lockVersion,
				metadata: decoded.metadata,
				created: decoded.created,
				updated: decoded.updated,
			});
			// eslint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives a value.
			return Option.some(account);
		}).pipe(Effect.mapError(cause => new AccountPersistenceDecodingFailure(cause)));
	}

	updateFromRequest(rq: AccountUpdateRequest): Account {
		return new Account({
			id: this.id,
			organizationId: this.organizationId,
			ledgerId: this.ledgerId,
			name: rq.name,
			description: rq.description,
			normalBalance: this.normalBalance,
			currency: this.currency,
			pendingCredits: this.pendingCredits,
			pendingDebits: this.pendingDebits,
			postedCredits: this.postedCredits,
			postedDebits: this.postedDebits,
			lockVersion: this.lockVersion,
			metadata: rq.metadata,
			created: this.created,
			updated: DateTime.utc(),
		});
	}

	toCreateRow(): AccountCreatePersistenceRow {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			ledgerId: this.ledgerId.toString(),
			name: this.name,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.description ?? null,
			normalBalance: this.normalBalance,
			currencyCode: this.currency.code,
			minorUnitExponent: this.currency.minorUnitExponent,
			pendingCredits: this.pendingCredits,
			pendingDebits: this.pendingDebits,
			postedCredits: this.postedCredits,
			postedDebits: this.postedDebits,
			lockVersion: this.lockVersion,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			metadata: this.metadata === undefined ? null : JSON.stringify(this.metadata),
			created: this.created.toJSDate(),
			updated: this.updated.toJSDate(),
		};
	}

	toUpdateRow(): AccountUpdateRow {
		return {
			name: this.name,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.description ?? null,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			metadata: this.metadata === undefined ? null : JSON.stringify(this.metadata),
			lockVersion: this.lockVersion + 1,
			updated: this.updated.toJSDate(),
		};
	}

	get balances(): readonly AccountBalance[] {
		const debitNormal = this.normalBalance === "debit";
		return [
			{
				balanceType: "pending",
				credits: this.pendingCredits,
				debits: this.pendingDebits,
				amount: debitNormal
					? this.pendingDebits - this.pendingCredits
					: this.pendingCredits - this.pendingDebits,
			},
			{
				balanceType: "posted",
				credits: this.postedCredits,
				debits: this.postedDebits,
				amount: debitNormal
					? this.postedDebits - this.postedCredits
					: this.postedCredits - this.postedDebits,
			},
			{
				balanceType: "availableBalance",
				credits: debitNormal ? this.pendingCredits : this.postedCredits,
				debits: debitNormal ? this.postedDebits : this.pendingDebits,
				amount: debitNormal
					? this.postedDebits - this.pendingCredits
					: this.postedCredits - this.pendingDebits,
			},
		];
	}
}

export type { AccountBalance, AccountMetadata, AccountOptions };
export { Account };
