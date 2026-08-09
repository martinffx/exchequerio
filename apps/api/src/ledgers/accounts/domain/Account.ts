import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import type { Currency, MinorUnits, NormalBalance } from "../../domain/Currency";

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

type AccountDetails = Pick<AccountOptions, "name" | "description" | "metadata">;
type AccountCreate = Pick<
	AccountOptions,
	| "id"
	| "organizationId"
	| "ledgerId"
	| "name"
	| "description"
	| "normalBalance"
	| "currency"
	| "metadata"
>;
type AccountUpdate = AccountDetails &
	Pick<AccountOptions, "id" | "organizationId" | "ledgerId"> & {
		readonly expectedLockVersion: number;
	};
type AccountBalanceType = "pending" | "posted" | "availableBalance";
type AccountBalance = Readonly<{
	balanceType: AccountBalanceType;
	credits: MinorUnits;
	debits: MinorUnits;
	amount: MinorUnits;
}>;

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

	withDetails(details: AccountDetails): Account {
		return new Account({ ...this, ...details });
	}
}

export type {
	AccountBalance,
	AccountCreate,
	AccountDetails,
	AccountMetadata,
	AccountOptions,
	AccountUpdate,
};
export { Account };
