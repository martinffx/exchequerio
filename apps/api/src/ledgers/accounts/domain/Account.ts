import { Effect, Option } from "effect";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import type { AccountRow } from "@/repo/schema";
import { parseId } from "@/lib/utils";
import type { AccountCreateRequest } from "../AccountSchema";
import { AccountPersistenceDecodingFailure } from "../AccountErrors";
import {
	makeCurrency,
	makeMinorUnits,
	type Currency,
	type MinorUnits,
	type NormalBalance,
} from "../../domain/Currency";

type AccountMetadata = Readonly<Record<string, string>>;

type AccountOptions = {
	readonly id: LedgerAccountID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	readonly name: string;
	readonly description?: string;
	readonly normalBalance: NormalBalance;
	readonly currency: Currency;
	readonly pendingAmount: MinorUnits;
	readonly postedAmount: MinorUnits;
	readonly availableAmount: MinorUnits;
	readonly pendingCredits: MinorUnits;
	readonly pendingDebits: MinorUnits;
	readonly postedCredits: MinorUnits;
	readonly postedDebits: MinorUnits;
	readonly availableCredits: MinorUnits;
	readonly availableDebits: MinorUnits;
	readonly lockVersion: number;
	readonly metadata?: AccountMetadata;
	readonly created: Date;
	readonly updated: Date;
};

type AccountBalanceType = "pending" | "posted" | "availableBalance";
type AccountBalance = Readonly<{
	balanceType: AccountBalanceType;
	credits: MinorUnits;
	debits: MinorUnits;
	amount: MinorUnits;
}>;

const decodeDate = (value: Date): Date => {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
		throw new Error("Invalid Account timestamp");
	}
	return value;
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

class Account {
	readonly id: LedgerAccountID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	readonly name: string;
	readonly description?: string;
	readonly normalBalance: NormalBalance;
	readonly currency: Currency;
	readonly pendingAmount: MinorUnits;
	readonly postedAmount: MinorUnits;
	readonly availableAmount: MinorUnits;
	readonly pendingCredits: MinorUnits;
	readonly pendingDebits: MinorUnits;
	readonly postedCredits: MinorUnits;
	readonly postedDebits: MinorUnits;
	readonly availableCredits: MinorUnits;
	readonly availableDebits: MinorUnits;
	readonly lockVersion: number;
	readonly metadata?: AccountMetadata;
	readonly created: Date;
	readonly updated: Date;

	constructor(options: AccountOptions) {
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

	static fromRequest(
		id: LedgerAccountID,
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: AccountCreateRequest
	): Account {
		const now = new Date();
		const zero = makeMinorUnits(0);
		return new Account({
			id,
			organizationId,
			ledgerId,
			name: request.name,
			description: request.description,
			normalBalance: request.normalBalance,
			currency: makeCurrency(request.currencyCode, request.minorUnitExponent),
			pendingAmount: zero,
			postedAmount: zero,
			availableAmount: zero,
			pendingCredits: zero,
			pendingDebits: zero,
			postedCredits: zero,
			postedDebits: zero,
			availableCredits: zero,
			availableDebits: zero,
			lockVersion: 1,
			metadata: request.metadata,
			created: now,
			updated: now,
		});
	}

	static fromRow(
		row: AccountRow | undefined
	): Effect.Effect<Option.Option<Account>, AccountPersistenceDecodingFailure> {
		if (row === undefined) return Effect.succeed(Option.none());

		return Effect.gen(function* () {
			const id = yield* parseId<"lat", LedgerAccountID>("lat", row.id);
			const organizationId = yield* parseId<"org", OrgID>("org", row.organizationId);
			const ledgerId = yield* parseId<"lgr", LedgerID>("lgr", row.ledgerId);
			const decoded = yield* Effect.try({
				try: () => ({
					currency: makeCurrency(row.currencyCode, row.minorUnitExponent),
					pendingAmount: makeMinorUnits(row.pendingAmount),
					postedAmount: makeMinorUnits(row.postedAmount),
					availableAmount: makeMinorUnits(row.availableAmount),
					pendingCredits: makeMinorUnits(row.pendingCredits),
					pendingDebits: makeMinorUnits(row.pendingDebits),
					postedCredits: makeMinorUnits(row.postedCredits),
					postedDebits: makeMinorUnits(row.postedDebits),
					availableCredits: makeMinorUnits(row.availableCredits),
					availableDebits: makeMinorUnits(row.availableDebits),
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
				pendingAmount: decoded.pendingAmount,
				postedAmount: decoded.postedAmount,
				availableAmount: decoded.availableAmount,
				pendingCredits: decoded.pendingCredits,
				pendingDebits: decoded.pendingDebits,
				postedCredits: decoded.postedCredits,
				postedDebits: decoded.postedDebits,
				availableCredits: decoded.availableCredits,
				availableDebits: decoded.availableDebits,
				lockVersion: decoded.lockVersion,
				metadata: decoded.metadata,
				created: decoded.created,
				updated: decoded.updated,
			});
			// eslint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives a value.
			return Option.some(account);
		}).pipe(Effect.mapError(cause => new AccountPersistenceDecodingFailure(cause)));
	}

	toRow(): AccountRow {
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
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			metadata: this.metadata === undefined ? null : JSON.stringify(this.metadata),
			created: this.created,
			updated: this.updated,
		};
	}

	get balances(): readonly AccountBalance[] {
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
}

export type { AccountBalance, AccountMetadata, AccountOptions };
export { Account };
