import { relations, sql } from "drizzle-orm";
import {
	bigint,
	check,
	foreignKey,
	index,
	integer,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

// Enums for ledger system
const ledgerNormalBalance = pgEnum("ledger_normal_balance", ["debit", "credit"]);
const ledgerTransactionStatus = pgEnum("ledger_transaction_status", [
	"pending",
	"posted",
	"voided",
]);
const ledgerEntryDirection = pgEnum("ledger_entry_direction", ["debit", "credit"]);
const ledgerSettlementStatus = pgEnum("ledger_settlement_status", [
	"drafting",
	"processing",
	"pending",
	"posted",
	"archiving",
	"archived",
]);

const OrganizationsTable = pgTable("organizations_table", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
});

type OrganizationRow = typeof OrganizationsTable.$inferSelect;
type OrganizationCreateRow = Required<typeof OrganizationsTable.$inferInsert>;
type OrganizationUpdateRow = Pick<OrganizationRow, "name" | "description" | "updated">;

// Ledgers: Chart of accounts container
const LedgersTable = pgTable(
	"ledgers",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => OrganizationsTable.id),
		name: text("name").notNull(),
		description: text("description"),
		metadata: text("metadata"),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
		updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		organizationIdx: index("idx_ledgers_organization").on(table.organizationId),
		organizationIdIdUnique: unique("unique_ledgers_organization_id_id").on(
			table.organizationId,
			table.id
		),
	})
);

type LedgerRow = typeof LedgersTable.$inferSelect;
type LedgerCreateRow = Required<typeof LedgersTable.$inferInsert>;
type LedgerUpdateRow = Pick<LedgerRow, "name" | "description" | "metadata" | "updated">;

// Ledger Accounts: Individual accounts (merchant wallets, fee accounts, etc.)
const LedgerAccountsTable = pgTable(
	"ledger_accounts",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => OrganizationsTable.id),
		ledgerId: text("ledger_id").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		normalBalance: ledgerNormalBalance("normal_balance").notNull(),
		currencyCode: text("currency_code").notNull(),
		minorUnitExponent: integer("minor_unit_exponent").notNull(),
		// Authoritative balance counters as BIGINT (integer minor units)
		pendingCredits: bigint("pending_credits", { mode: "number" }).notNull().default(0),
		pendingDebits: bigint("pending_debits", { mode: "number" }).notNull().default(0),
		postedCredits: bigint("posted_credits", { mode: "number" }).notNull().default(0),
		postedDebits: bigint("posted_debits", { mode: "number" }).notNull().default(0),
		lockVersion: integer("lock_version").notNull().default(1),
		metadata: text("metadata"), // TEXT for DSQL compatibility (JSON string)
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
		updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		organizationIdx: index("idx_ledger_accounts_organization").on(table.organizationId),
		organizationLedgerFk: foreignKey({
			name: "ledger_accounts_organization_ledger_fk",
			columns: [table.organizationId, table.ledgerId],
			foreignColumns: [LedgersTable.organizationId, LedgersTable.id],
		}),
		uniqueNamePerLedger: uniqueIndex("unique_account_name_per_ledger").on(table.ledgerId, table.name),
		currencyCodeNotBlank: check(
			"ledger_accounts_currency_code_not_blank",
			sql`btrim(${table.currencyCode}) <> ''`
		),
		minorUnitExponentNonnegative: check(
			"ledger_accounts_minor_unit_exponent_nonnegative",
			sql`${table.minorUnitExponent} >= 0`
		),
		balancesSafeIntegers: check(
			"ledger_accounts_balances_safe_integers",
			sql`${table.pendingCredits} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.pendingDebits} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.postedCredits} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.postedDebits} BETWEEN -9007199254740991 AND 9007199254740991`
		),
		organizationLedgerIdUnique: unique("unique_ledger_accounts_organization_ledger_id").on(
			table.organizationId,
			table.ledgerId,
			table.id
		),
	})
);

type AccountRow = typeof LedgerAccountsTable.$inferSelect;
type AccountCreateRow = Required<typeof LedgerAccountsTable.$inferInsert>;
type AccountUpdateRow = Pick<
	AccountRow,
	"name" | "description" | "metadata" | "lockVersion" | "updated"
>;

// Ledger Transactions: Double-entry transaction containers
const LedgerTransactionsTable = pgTable(
	"ledger_transactions",
	{
		id: text("id").primaryKey(),
		ledgerId: text("ledger_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => OrganizationsTable.id),
		idempotencyKey: text("idempotency_key"),
		description: text("description"),
		status: ledgerTransactionStatus("status").notNull().default("pending"),
		postedAt: timestamp("posted_at", { withTimezone: true }),
		metadata: text("metadata"),
		lockVersion: integer("lock_version").notNull().default(1),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
		updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		organizationIdx: index("idx_ledger_transactions_organization").on(table.organizationId),
		statusIdx: index("idx_ledger_transactions_status").on(table.status),
		organizationLedgerFk: foreignKey({
			name: "ledger_transactions_organization_ledger_fk",
			columns: [table.organizationId, table.ledgerId],
			foreignColumns: [LedgersTable.organizationId, LedgersTable.id],
		}),
		organizationLedgerIdUnique: unique("unique_ledger_transactions_organization_ledger_id").on(
			table.organizationId,
			table.ledgerId,
			table.id
		),
		organizationIdempotencyKeyUnique: uniqueIndex(
			"unique_ledger_transactions_organization_idempotency_key"
		).on(table.organizationId, table.idempotencyKey),
		ledgerCreatedIdIdx: index("idx_ledger_transactions_ledger_created_id").on(
			table.ledgerId,
			table.created.desc(),
			table.id.desc()
		),
	})
);

type LedgerTransactionRow = typeof LedgerTransactionsTable.$inferSelect;
type LedgerTransactionCreateRow = typeof LedgerTransactionsTable.$inferInsert;

// Ledger Transaction Entries: Individual debit/credit entries
const LedgerTransactionEntriesTable = pgTable(
	"ledger_transaction_entries",
	{
		id: text("id").primaryKey(),
		transactionId: text("transaction_id").notNull(),
		accountId: text("account_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => OrganizationsTable.id),
		ledgerId: text("ledger_id").notNull(),
		direction: ledgerEntryDirection("direction").notNull(),
		amount: bigint("amount", { mode: "number" }).notNull(), // Integer minor units
		metadata: text("metadata"),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		// Indexes for performance
		organizationIdx: index("idx_ledger_transaction_entries_organization").on(table.organizationId),
		accountIdx: index("idx_ledger_transaction_entries_account").on(table.accountId),
		transactionIdx: index("idx_ledger_transaction_entries_transaction").on(table.transactionId),
		transactionOwnershipFk: foreignKey({
			name: "ledger_transaction_entries_transaction_ownership_fk",
			columns: [table.organizationId, table.ledgerId, table.transactionId],
			foreignColumns: [
				LedgerTransactionsTable.organizationId,
				LedgerTransactionsTable.ledgerId,
				LedgerTransactionsTable.id,
			],
		}),
		accountOwnershipFk: foreignKey({
			name: "ledger_transaction_entries_account_ownership_fk",
			columns: [table.organizationId, table.ledgerId, table.accountId],
			foreignColumns: [
				LedgerAccountsTable.organizationId,
				LedgerAccountsTable.ledgerId,
				LedgerAccountsTable.id,
			],
		}),
		amountPositiveAndSafe: check(
			"ledger_transaction_entries_amount_positive_and_safe",
			sql`${table.amount} > 0 AND ${table.amount} <= 9007199254740991`
		),
	})
);

// Account Category Definitions: Chart of accounts structure
const LedgerAccountCategoriesTable = pgTable("ledger_account_categories", {
	id: text("id").primaryKey(),
	ledgerId: text("ledger_id")
		.notNull()
		.references(() => LedgersTable.id),
	name: text("name").notNull(),
	description: text("description"),
	normalBalance: ledgerNormalBalance("normal_balance").notNull(),
	parentCategoryId: text("parent_category_id"),
	metadata: text("metadata"),
	created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
});

// Junction: Category parent relationships (many-to-many)
const LedgerAccountCategoryParentsTable = pgTable(
	"ledger_account_category_parents",
	{
		categoryId: text("category_id")
			.notNull()
			.references(() => LedgerAccountCategoriesTable.id, { onDelete: "cascade" }),
		parentCategoryId: text("parent_category_id")
			.notNull()
			.references(() => LedgerAccountCategoriesTable.id, { onDelete: "cascade" }),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		pk: primaryKey({ columns: [table.categoryId, table.parentCategoryId] }),
		noSelfRef: check("no_self_reference", sql`${table.categoryId} <> ${table.parentCategoryId}`),
		parentIdx: index("idx_category_parents_parent").on(table.parentCategoryId),
	})
);

// Junction: Account-to-category membership (many-to-many)
const LedgerAccountCategoryAccountsTable = pgTable(
	"ledger_account_category_accounts",
	{
		categoryId: text("category_id")
			.notNull()
			.references(() => LedgerAccountCategoriesTable.id, { onDelete: "cascade" }),
		accountId: text("account_id")
			.notNull()
			.references(() => LedgerAccountsTable.id, { onDelete: "cascade" }),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		pk: primaryKey({ columns: [table.categoryId, table.accountId] }),
		accountIdx: index("idx_category_accounts_account").on(table.accountId),
	})
);

// Account Balance Monitors: Real-time balance tracking with alerts
const LedgerAccountBalanceMonitorsTable = pgTable("ledger_account_balance_monitors", {
	id: text("id").primaryKey(),
	accountId: text("account_id")
		.notNull()
		.references(() => LedgerAccountsTable.id),
	name: text("name").notNull(),
	description: text("description"),
	alertThreshold: numeric("alert_threshold", { precision: 20, scale: 4 }).notNull().default("0"),
	isActive: integer("is_active").notNull().default(1), // SQLite-compatible boolean
	metadata: text("metadata"),
	created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
});

// Account Statements: Periodic balance snapshots and statements
const LedgerAccountStatementsTable = pgTable("ledger_account_statements", {
	id: text("id").primaryKey(),
	ledgerId: text("ledger_id")
		.notNull()
		.references(() => LedgersTable.id),
	accountId: text("account_id")
		.notNull()
		.references(() => LedgerAccountsTable.id),
	statementDate: timestamp("statement_date", { withTimezone: true }).notNull(),
	openingBalance: numeric("opening_balance", { precision: 20, scale: 4 }).notNull().default("0"),
	closingBalance: numeric("closing_balance", { precision: 20, scale: 4 }).notNull().default("0"),
	totalCredits: numeric("total_credits", { precision: 20, scale: 4 }).notNull().default("0"),
	totalDebits: numeric("total_debits", { precision: 20, scale: 4 }).notNull().default("0"),
	transactionCount: integer("transaction_count").notNull().default(0),
	metadata: text("metadata"),
	created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
});

// Ledger Account Settlements: Modern Treasury-style settlement transactions
const LedgerAccountSettlementsTable = pgTable(
	"ledger_account_settlements",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => OrganizationsTable.id),
		transactionId: text("transaction_id").references(() => LedgerTransactionsTable.id),
		settledAccountId: text("settled_account_id")
			.notNull()
			.references(() => LedgerAccountsTable.id),
		contraAccountId: text("contra_account_id")
			.notNull()
			.references(() => LedgerAccountsTable.id),
		amount: bigint("amount", { mode: "number" }).notNull().default(0),
		normalBalance: ledgerNormalBalance("normal_balance").notNull(),
		currency: text("currency").notNull(),
		currencyExponent: integer("currency_exponent").notNull().default(2),
		status: ledgerSettlementStatus("status").notNull().default("drafting"),
		description: text("description"),
		externalReference: text("external_reference"),
		// Upper bound for auto-gathering entries by effective date (null = manual mode or use current time)
		effectiveAtUpperBound: timestamp("effective_at_upper_bound", { withTimezone: true }),
		metadata: text("metadata"),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
		updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		orgIdx: index("idx_settlements_org").on(table.organizationId),
		statusIdx: index("idx_settlements_status").on(table.status),
		settledAccountIdx: index("idx_settlements_settled_account").on(table.settledAccountId),
		noSelfSettle: check("no_self_settle", sql`${table.settledAccountId} <> ${table.contraAccountId}`),
	})
);

// Junction table for settlement entries
const LedgerAccountSettlementEntriesTable = pgTable(
	"ledger_account_settlement_entries",
	{
		settlementId: text("settlement_id")
			.notNull()
			.references(() => LedgerAccountSettlementsTable.id, { onDelete: "cascade" }),
		entryId: text("entry_id")
			.notNull()
			.references(() => LedgerTransactionEntriesTable.id, { onDelete: "cascade" }),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		pk: primaryKey({ columns: [table.settlementId, table.entryId] }),
		entryIdx: index("idx_settlement_entries_entry").on(table.entryId),
	})
);

// Define relations for Drizzle ORM
const organizationsRelations = relations(OrganizationsTable, ({ many }) => ({
	ledgers: many(LedgersTable),
}));

const ledgersRelations = relations(LedgersTable, ({ one, many }) => ({
	organization: one(OrganizationsTable, {
		fields: [LedgersTable.organizationId],
		references: [OrganizationsTable.id],
	}),
	accounts: many(LedgerAccountsTable),
	transactions: many(LedgerTransactionsTable),
	categories: many(LedgerAccountCategoriesTable),
}));

const ledgerAccountsRelations = relations(LedgerAccountsTable, ({ one, many }) => ({
	ledger: one(LedgersTable, {
		fields: [LedgerAccountsTable.ledgerId],
		references: [LedgersTable.id],
	}),
	entries: many(LedgerTransactionEntriesTable),
	monitors: many(LedgerAccountBalanceMonitorsTable),
	statements: many(LedgerAccountStatementsTable),
	settlementsAsSettled: many(LedgerAccountSettlementsTable, {
		relationName: "settledAccount",
	}),
	settlementsAsContra: many(LedgerAccountSettlementsTable, {
		relationName: "contraAccount",
	}),
}));

const ledgerTransactionsRelations = relations(LedgerTransactionsTable, ({ one, many }) => ({
	ledger: one(LedgersTable, {
		fields: [LedgerTransactionsTable.ledgerId],
		references: [LedgersTable.id],
	}),
	entries: many(LedgerTransactionEntriesTable),
}));

const ledgerTransactionEntriesRelations = relations(LedgerTransactionEntriesTable, ({ one }) => ({
	transaction: one(LedgerTransactionsTable, {
		fields: [LedgerTransactionEntriesTable.transactionId],
		references: [LedgerTransactionsTable.id],
	}),
	account: one(LedgerAccountsTable, {
		fields: [LedgerTransactionEntriesTable.accountId],
		references: [LedgerAccountsTable.id],
	}),
}));

const ledgerAccountCategoriesRelations = relations(
	LedgerAccountCategoriesTable,
	({ one, many }) => ({
		ledger: one(LedgersTable, {
			fields: [LedgerAccountCategoriesTable.ledgerId],
			references: [LedgersTable.id],
		}),
		parentLinks: many(LedgerAccountCategoryParentsTable, { relationName: "childCategory" }),
		childLinks: many(LedgerAccountCategoryParentsTable, { relationName: "parentCategory" }),
		accountLinks: many(LedgerAccountCategoryAccountsTable),
	})
);

const ledgerAccountSettlementsRelations = relations(
	LedgerAccountSettlementsTable,
	({ one, many }) => ({
		organization: one(OrganizationsTable, {
			fields: [LedgerAccountSettlementsTable.organizationId],
			references: [OrganizationsTable.id],
		}),
		settledAccount: one(LedgerAccountsTable, {
			fields: [LedgerAccountSettlementsTable.settledAccountId],
			references: [LedgerAccountsTable.id],
			relationName: "settledAccount",
		}),
		contraAccount: one(LedgerAccountsTable, {
			fields: [LedgerAccountSettlementsTable.contraAccountId],
			references: [LedgerAccountsTable.id],
			relationName: "contraAccount",
		}),
		transaction: one(LedgerTransactionsTable, {
			fields: [LedgerAccountSettlementsTable.transactionId],
			references: [LedgerTransactionsTable.id],
		}),
		settlementEntries: many(LedgerAccountSettlementEntriesTable),
	})
);

export {
	// Tables
	OrganizationsTable,
	LedgersTable,
	LedgerAccountsTable,
	LedgerTransactionsTable,
	LedgerTransactionEntriesTable,
	LedgerAccountCategoriesTable,
	LedgerAccountCategoryParentsTable,
	LedgerAccountCategoryAccountsTable,
	LedgerAccountBalanceMonitorsTable,
	LedgerAccountStatementsTable,
	LedgerAccountSettlementsTable,
	LedgerAccountSettlementEntriesTable,
	// Relations
	organizationsRelations,
	ledgersRelations,
	ledgerAccountsRelations,
	ledgerTransactionsRelations,
	ledgerTransactionEntriesRelations,
	ledgerAccountCategoriesRelations,
	ledgerAccountSettlementsRelations,
	// Enums
	ledgerNormalBalance,
	ledgerTransactionStatus,
	ledgerEntryDirection,
	ledgerSettlementStatus,
};
export type {
	AccountCreateRow,
	AccountRow,
	AccountUpdateRow,
	LedgerCreateRow,
	LedgerRow,
	LedgerUpdateRow,
	LedgerTransactionRow,
	LedgerTransactionCreateRow,
	OrganizationCreateRow,
	OrganizationRow,
	OrganizationUpdateRow,
};
