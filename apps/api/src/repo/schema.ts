import { type BuildQueryResult, defineRelations, sql } from "drizzle-orm";
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
type OrganizationInsertRow = Required<typeof OrganizationsTable.$inferInsert>;
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
type LedgerInsertRow = Required<typeof LedgersTable.$inferInsert>;
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
		// Balance values as BIGINT (integer minor units)
		pendingAmount: bigint("pending_amount", { mode: "number" }).notNull().default(0),
		postedAmount: bigint("posted_amount", { mode: "number" }).notNull().default(0),
		availableAmount: bigint("available_amount", { mode: "number" }).notNull().default(0),
		pendingCredits: bigint("pending_credits", { mode: "number" }).notNull().default(0),
		pendingDebits: bigint("pending_debits", { mode: "number" }).notNull().default(0),
		postedCredits: bigint("posted_credits", { mode: "number" }).notNull().default(0),
		postedDebits: bigint("posted_debits", { mode: "number" }).notNull().default(0),
		availableCredits: bigint("available_credits", { mode: "number" }).notNull().default(0),
		availableDebits: bigint("available_debits", { mode: "number" }).notNull().default(0),
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
		balancesSafeIntegers: check(
			"ledger_accounts_balances_safe_integers",
			sql`${table.pendingAmount} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.postedAmount} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.availableAmount} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.pendingCredits} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.pendingDebits} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.postedCredits} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.postedDebits} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.availableCredits} BETWEEN -9007199254740991 AND 9007199254740991
				AND ${table.availableDebits} BETWEEN -9007199254740991 AND 9007199254740991`
		),
		postedBalanceIdx: index("idx_ledger_accounts_posted_balance").on(
			table.ledgerId,
			table.postedAmount
		),
		availableBalanceIdx: index("idx_ledger_accounts_available_balance").on(
			table.ledgerId,
			table.availableAmount
		),
		organizationLedgerIdUnique: unique("unique_ledger_accounts_organization_ledger_id").on(
			table.organizationId,
			table.ledgerId,
			table.id
		),
	})
);
type LedgerAccountRow = typeof LedgerAccountsTable.$inferSelect;
type LedgerAccountInsertRow = typeof LedgerAccountsTable.$inferInsert;

// Ledger Transactions: Double-entry transaction containers
const LedgerTransactionsTable = pgTable(
	"ledger_transactions",
	{
		id: text("id").primaryKey(),
		ledgerId: text("ledger_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => OrganizationsTable.id),
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
		ledgerCreatedIdIdx: index("idx_ledger_transactions_ledger_created_id").on(
			table.ledgerId,
			table.created.desc(),
			table.id.desc()
		),
	})
);
type LedgerTransactionRow = typeof LedgerTransactionsTable.$inferSelect;
type LedgerTransactionInsertRow = typeof LedgerTransactionsTable.$inferInsert;

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
		currency: text("currency").notNull(),
		status: ledgerTransactionStatus("status").notNull(),
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
type LedgerTransactionEntryRow = typeof LedgerTransactionEntriesTable.$inferSelect;
type LedgerTransactionEntryInsertRow = typeof LedgerTransactionEntriesTable.$inferInsert;

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
type LedgerAccountCategoryRow = typeof LedgerAccountCategoriesTable.$inferSelect;
type LedgerAccountCategoryInsertRow = Required<typeof LedgerAccountCategoriesTable.$inferInsert>;

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
type LedgerAccountCategoryParentRow = typeof LedgerAccountCategoryParentsTable.$inferSelect;
type LedgerAccountCategoryParentInsertRow = Required<
	typeof LedgerAccountCategoryParentsTable.$inferInsert
>;

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
type LedgerAccountCategoryAccountRow = typeof LedgerAccountCategoryAccountsTable.$inferSelect;
type LedgerAccountCategoryAccountInsertRow = Required<
	typeof LedgerAccountCategoryAccountsTable.$inferInsert
>;

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
type LedgerAccountBalanceMonitorRow = typeof LedgerAccountBalanceMonitorsTable.$inferSelect;
type LedgerAccountBalanceMonitorInsertRow = Required<
	typeof LedgerAccountBalanceMonitorsTable.$inferInsert
>;

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
type LedgerAccountStatementRow = typeof LedgerAccountStatementsTable.$inferSelect;
type LedgerAccountStatementInsertRow = Required<typeof LedgerAccountStatementsTable.$inferInsert>;

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
type LedgerAccountSettlementRow = typeof LedgerAccountSettlementsTable.$inferSelect;
type LedgerAccountSettlementInsertRow = Required<typeof LedgerAccountSettlementsTable.$inferInsert>;

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
type LedgerAccountSettlementEntryRow = typeof LedgerAccountSettlementEntriesTable.$inferSelect;
type LedgerAccountSettlementEntryInsertRow = Required<
	typeof LedgerAccountSettlementEntriesTable.$inferInsert
>;

const schemaRelations = defineRelations(
	{
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
	},
	r => ({
		OrganizationsTable: {
			ledgers: r.many.LedgersTable(),
			settlements: r.many.LedgerAccountSettlementsTable(),
		},
		LedgersTable: {
			organization: r.one.OrganizationsTable({
				from: r.LedgersTable.organizationId,
				to: r.OrganizationsTable.id,
			}),
			accounts: r.many.LedgerAccountsTable(),
			transactions: r.many.LedgerTransactionsTable(),
			categories: r.many.LedgerAccountCategoriesTable(),
			statements: r.many.LedgerAccountStatementsTable(),
		},
		LedgerAccountsTable: {
			ledger: r.one.LedgersTable({
				from: r.LedgerAccountsTable.ledgerId,
				to: r.LedgersTable.id,
			}),
			entries: r.many.LedgerTransactionEntriesTable(),
			monitors: r.many.LedgerAccountBalanceMonitorsTable(),
			statements: r.many.LedgerAccountStatementsTable(),
			categoryLinks: r.many.LedgerAccountCategoryAccountsTable(),
			settlementsAsSettled: r.many.LedgerAccountSettlementsTable({ alias: "settledAccount" }),
			settlementsAsContra: r.many.LedgerAccountSettlementsTable({ alias: "contraAccount" }),
		},
		LedgerTransactionsTable: {
			ledger: r.one.LedgersTable({
				from: r.LedgerTransactionsTable.ledgerId,
				to: r.LedgersTable.id,
			}),
			entries: r.many.LedgerTransactionEntriesTable(),
			settlements: r.many.LedgerAccountSettlementsTable(),
		},
		LedgerTransactionEntriesTable: {
			transaction: r.one.LedgerTransactionsTable({
				from: r.LedgerTransactionEntriesTable.transactionId,
				to: r.LedgerTransactionsTable.id,
			}),
			account: r.one.LedgerAccountsTable({
				from: r.LedgerTransactionEntriesTable.accountId,
				to: r.LedgerAccountsTable.id,
			}),
			settlementLinks: r.many.LedgerAccountSettlementEntriesTable(),
		},
		LedgerAccountCategoriesTable: {
			ledger: r.one.LedgersTable({
				from: r.LedgerAccountCategoriesTable.ledgerId,
				to: r.LedgersTable.id,
			}),
			parentLinks: r.many.LedgerAccountCategoryParentsTable({ alias: "childCategory" }),
			childLinks: r.many.LedgerAccountCategoryParentsTable({ alias: "parentCategory" }),
			accountLinks: r.many.LedgerAccountCategoryAccountsTable(),
		},
		LedgerAccountCategoryParentsTable: {
			childCategory: r.one.LedgerAccountCategoriesTable({
				from: r.LedgerAccountCategoryParentsTable.categoryId,
				to: r.LedgerAccountCategoriesTable.id,
				alias: "childCategory",
			}),
			parentCategory: r.one.LedgerAccountCategoriesTable({
				from: r.LedgerAccountCategoryParentsTable.parentCategoryId,
				to: r.LedgerAccountCategoriesTable.id,
				alias: "parentCategory",
			}),
		},
		LedgerAccountCategoryAccountsTable: {
			category: r.one.LedgerAccountCategoriesTable({
				from: r.LedgerAccountCategoryAccountsTable.categoryId,
				to: r.LedgerAccountCategoriesTable.id,
			}),
			account: r.one.LedgerAccountsTable({
				from: r.LedgerAccountCategoryAccountsTable.accountId,
				to: r.LedgerAccountsTable.id,
			}),
		},
		LedgerAccountBalanceMonitorsTable: {
			account: r.one.LedgerAccountsTable({
				from: r.LedgerAccountBalanceMonitorsTable.accountId,
				to: r.LedgerAccountsTable.id,
			}),
		},
		LedgerAccountStatementsTable: {
			ledger: r.one.LedgersTable({
				from: r.LedgerAccountStatementsTable.ledgerId,
				to: r.LedgersTable.id,
			}),
			account: r.one.LedgerAccountsTable({
				from: r.LedgerAccountStatementsTable.accountId,
				to: r.LedgerAccountsTable.id,
			}),
		},
		LedgerAccountSettlementsTable: {
			organization: r.one.OrganizationsTable({
				from: r.LedgerAccountSettlementsTable.organizationId,
				to: r.OrganizationsTable.id,
			}),
			settledAccount: r.one.LedgerAccountsTable({
				from: r.LedgerAccountSettlementsTable.settledAccountId,
				to: r.LedgerAccountsTable.id,
				alias: "settledAccount",
			}),
			contraAccount: r.one.LedgerAccountsTable({
				from: r.LedgerAccountSettlementsTable.contraAccountId,
				to: r.LedgerAccountsTable.id,
				alias: "contraAccount",
			}),
			transaction: r.one.LedgerTransactionsTable({
				from: r.LedgerAccountSettlementsTable.transactionId,
				to: r.LedgerTransactionsTable.id,
			}),
			settlementEntries: r.many.LedgerAccountSettlementEntriesTable(),
		},
		LedgerAccountSettlementEntriesTable: {
			settlement: r.one.LedgerAccountSettlementsTable({
				from: r.LedgerAccountSettlementEntriesTable.settlementId,
				to: r.LedgerAccountSettlementsTable.id,
			}),
			entry: r.one.LedgerTransactionEntriesTable({
				from: r.LedgerAccountSettlementEntriesTable.entryId,
				to: r.LedgerTransactionEntriesTable.id,
			}),
		},
	})
);

type LedgerTransactionWithEntriesRow = BuildQueryResult<
	typeof schemaRelations,
	(typeof schemaRelations)["LedgerTransactionsTable"],
	{ with: { entries: true } }
>;

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
	schemaRelations,
	// Enums
	ledgerNormalBalance,
	ledgerTransactionStatus,
	ledgerEntryDirection,
	ledgerSettlementStatus,
};
export type {
	LedgerAccountInsertRow,
	LedgerAccountRow,
	LedgerAccountBalanceMonitorInsertRow,
	LedgerAccountBalanceMonitorRow,
	LedgerAccountCategoryAccountInsertRow,
	LedgerAccountCategoryAccountRow,
	LedgerAccountCategoryInsertRow,
	LedgerAccountCategoryParentInsertRow,
	LedgerAccountCategoryParentRow,
	LedgerAccountCategoryRow,
	LedgerAccountSettlementEntryInsertRow,
	LedgerAccountSettlementEntryRow,
	LedgerAccountSettlementInsertRow,
	LedgerAccountSettlementRow,
	LedgerAccountStatementInsertRow,
	LedgerAccountStatementRow,
	LedgerInsertRow,
	LedgerRow,
	LedgerTransactionEntryInsertRow,
	LedgerTransactionEntryRow,
	LedgerTransactionInsertRow,
	LedgerTransactionRow,
	LedgerTransactionWithEntriesRow,
	LedgerUpdateRow,
	OrganizationInsertRow,
	OrganizationRow,
	OrganizationUpdateRow,
};
