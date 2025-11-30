import { relations, sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
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
		idempotencyKey: text("idempotency_key").unique(),
		description: text("description"),
		status: ledgerTransactionStatus("status").notNull().default("pending"),
		metadata: text("metadata"),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
		updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		statusIdx: index("idx_ledger_transactions_status").on(table.status),
		createdIdx: index("idx_ledger_transactions_created").on(table.created),
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
		direction: ledgerEntryDirection("direction").notNull(),
		amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
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

// Settlement Batches: Automated settlement processing
const LedgerAccountSettlementsTable = pgTable(
	"ledger_account_settlements",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id")
			.notNull()
			.references(() => LedgerAccountsTable.id),
		batchId: text("batch_id").notNull(),
		settlementDate: timestamp("settlement_date", { withTimezone: true }).defaultNow().notNull(),
		settlementAmount: numeric("settlement_amount", {
			precision: 20,
			scale: 4,
		})
			.notNull()
			.default("0"),
		status: ledgerSettlementStatus("status").notNull().default("drafting"),
		externalReference: text("external_reference"),
		metadata: text("metadata"),
		created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
		updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
	},
	table => ({
		batchIdx: index("idx_ledger_account_settlements_batch").on(table.batchId),
		statusIdx: index("idx_ledger_account_settlements_status").on(table.status),
		dateIdx: index("idx_ledger_account_settlements_date").on(table.settlementDate),
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
	settlements: many(LedgerAccountSettlementsTable),
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

export {
	// Tables
	OrganizationsTable,
	LedgersTable,
	LedgerAccountsTable,
	LedgerTransactionsTable,
	LedgerTransactionEntriesTable,
	LedgerAccountCategoriesTable,
	LedgerAccountBalanceMonitorsTable,
	LedgerAccountStatementsTable,
	LedgerAccountSettlementsTable,
	// Relations
	organizationsRelations,
	ledgersRelations,
	ledgerAccountsRelations,
	ledgerTransactionsRelations,
	ledgerTransactionEntriesRelations,
	// Enums
	ledgerNormalBalance,
	ledgerTransactionStatus,
	ledgerEntryDirection,
	ledgerSettlementStatus,
};
