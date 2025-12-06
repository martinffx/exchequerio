import { relations, sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

// Enums for ledger system
const ledgerNormalBalance = pgEnum("ledger_normal_balance", ["debit", "credit"]);
const ledgerTransactionStatus = pgEnum("ledger_transaction_status", [
	"pending",
	"posted",
	"archived",
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

// Ledgers: Chart of accounts container
const LedgersTable = pgTable("ledgers", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => OrganizationsTable.id),
	name: text("name").notNull(),
	description: text("description"),
	currency: text("currency").notNull().default("USD"),
	currencyExponent: integer("currency_exponent").notNull().default(2),
	metadata: text("metadata"),
	created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
});

// Ledger Accounts: Individual accounts (merchant wallets, fee accounts, etc.)
const LedgerAccountsTable = pgTable(
	"ledger_accounts",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => OrganizationsTable.id),
		ledgerId: text("ledger_id")
			.notNull()
			.references(() => LedgersTable.id),
		name: text("name").notNull(),
		description: text("description"),
		normalBalance: ledgerNormalBalance("normal_balance").notNull(),
		// Individual balance columns as BIGINT (integer minor units)
		pendingAmount: bigint("pending_amount", { mode: "number" }).notNull().default(0),
		postedAmount: bigint("posted_amount", { mode: "number" }).notNull().default(0),
		availableAmount: bigint("available_amount", { mode: "number" }).notNull().default(0),
		pendingCredits: bigint("pending_credits", { mode: "number" }).notNull().default(0),
		pendingDebits: bigint("pending_debits", { mode: "number" }).notNull().default(0),
		postedCredits: bigint("posted_credits", { mode: "number" }).notNull().default(0),
		postedDebits: bigint("posted_debits", { mode: "number" }).notNull().default(0),
		availableCredits: bigint("available_credits", { mode: "number" }).notNull().default(0),
		availableDebits: bigint("available_debits", { mode: "number" }).notNull().default(0),
		lockVersion: integer("lock_version").notNull().default(0),
		metadata: text("metadata"), // TEXT for DSQL compatibility (JSON string)
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
		updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		uniqueNamePerLedger: uniqueIndex("unique_account_name_per_ledger").on(table.ledgerId, table.name),
		postedBalanceIdx: index("idx_ledger_accounts_posted_balance").on(
			table.ledgerId,
			table.postedAmount
		),
		availableBalanceIdx: index("idx_ledger_accounts_available_balance").on(
			table.ledgerId,
			table.availableAmount
		),
	})
);

// Ledger Transactions: Double-entry transaction containers
const LedgerTransactionsTable = pgTable(
	"ledger_transactions",
	{
		id: text("id").primaryKey(),
		ledgerId: text("ledger_id")
			.notNull()
			.references(() => LedgersTable.id),
		organizationId: text("organization_id")
			.notNull()
			.references(() => OrganizationsTable.id),
		idempotencyKey: text("idempotency_key").unique(),
		description: text("description"),
		status: ledgerTransactionStatus("status").notNull().default("pending"),
		// When transaction happened for reporting purposes (defaults to created time)
		effectiveAt: timestamp("effective_at", { withTimezone: true }).defaultNow().notNull(),
		metadata: text("metadata"),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
		updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		statusIdx: index("idx_ledger_transactions_status").on(table.status),
		createdIdx: index("idx_ledger_transactions_created").on(table.created),
		effectiveAtIdx: index("idx_ledger_transactions_effective_at").on(table.effectiveAt),
	})
);

// Ledger Transaction Entries: Individual debit/credit entries
const LedgerTransactionEntriesTable = pgTable(
	"ledger_transaction_entries",
	{
		id: text("id").primaryKey(),
		transactionId: text("transaction_id")
			.notNull()
			.references(() => LedgerTransactionsTable.id),
		accountId: text("account_id")
			.notNull()
			.references(() => LedgerAccountsTable.id),
		organizationId: text("organization_id")
			.notNull()
			.references(() => OrganizationsTable.id),
		direction: ledgerEntryDirection("direction").notNull(),
		amount: bigint("amount", { mode: "number" }).notNull(), // Integer minor units
		currency: text("currency").notNull(),
		currencyExponent: bigint("currency_exponent", { mode: "number" }).notNull(),
		status: ledgerTransactionStatus("status").notNull().default("pending"),
		metadata: text("metadata"),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
		updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		// Indexes for performance
		accountIdx: index("idx_ledger_transaction_entries_account").on(table.accountId),
		transactionIdx: index("idx_ledger_transaction_entries_transaction").on(table.transactionId),
		statusIdx: index("idx_ledger_transaction_entries_status").on(table.status),
		// Constraint: amount must be positive
		positiveAmount: check("positive_amount", sql`${table.amount} > 0`),
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
		ledgerTransactionId: text("ledger_transaction_id").references(() => LedgerTransactionsTable.id),
		settledLedgerAccountId: text("settled_ledger_account_id")
			.notNull()
			.references(() => LedgerAccountsTable.id),
		contraLedgerAccountId: text("contra_ledger_account_id")
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
		settledAccountIdx: index("idx_settlements_settled_account").on(table.settledLedgerAccountId),
		noSelfSettle: check(
			"no_self_settle",
			sql`${table.settledLedgerAccountId} <> ${table.contraLedgerAccountId}`
		),
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
			fields: [LedgerAccountSettlementsTable.settledLedgerAccountId],
			references: [LedgerAccountsTable.id],
			relationName: "settledAccount",
		}),
		contraAccount: one(LedgerAccountsTable, {
			fields: [LedgerAccountSettlementsTable.contraLedgerAccountId],
			references: [LedgerAccountsTable.id],
			relationName: "contraAccount",
		}),
		transaction: one(LedgerTransactionsTable, {
			fields: [LedgerAccountSettlementsTable.ledgerTransactionId],
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
