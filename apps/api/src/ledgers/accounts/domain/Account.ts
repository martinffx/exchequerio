import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import type { AccountCreateRow, AccountRow, AccountUpdateRow } from "@/repo/schema";
import { parseId, parseDate, parseMetadata } from "@/lib/utils";
import type { AccountCreateRequest, AccountUpdateRequest } from "../AccountSchema";
import { AccountPersistenceDecodingFailure } from "../AccountErrors";

type CurrencyCode = string
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
	readonly currency: CurrencyCode;
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

class Account {
	readonly id: LedgerAccountID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	readonly name: string;
	readonly description?: string;
	readonly normalBalance: AccountOptions["normalBalance"];
	readonly currency: CurrencyCode;
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
			currency: request.currencyCode,
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

    return Effect.all([
      parseId<"lat", LedgerAccountID>("lat", row.id),
      parseId<"org", OrgID>("org", row.organizationId),
      parseId<"lgr", LedgerID>("lgr", row.ledgerId),
      parseMetadata(row.metadata),
      parseDate(row.created),
      parseDate(row.updated)
         ]
    ).pipe(
      Effect.map(([id, organizationId, ledgerId, metadata, created, updated]) => {
        const account = new Account({
          id,
          organizationId,
          ledgerId,
          name: row.name,
          description: row.description ?? undefined,
          normalBalance: row.normalBalance,
          currency: row.currencyCode,
          pendingCredits: row.pendingCredits,
          pendingDebits: row.pendingDebits,
          postedCredits: row.postedCredits,
          postedDebits: row.postedDebits,
          lockVersion: row.lockVersion,
          metadata,
          created,
          updated,
        })
        // oxlint-disable-next-line unicorn/no-array-callback-reference
        return Option.some(account)
      }),
    ).pipe(Effect.mapError(cause => new AccountPersistenceDecodingFailure(cause)));
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
			currencyCode: this.currency,
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

export type { AccountBalance, AccountMetadata, AccountOptions, CurrencyCode };
export { Account };
