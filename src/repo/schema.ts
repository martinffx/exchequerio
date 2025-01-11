import { text, uuid, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";

const OrganizationsTable = pgTable("organizations_table", {
	id: uuid("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	created: timestamp("created", { withTimezone: true }).defaultNow().notNull(),
	updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
});

type InsertOrganization = typeof OrganizationsTable.$inferInsert;
type SelectOrganization = typeof OrganizationsTable.$inferSelect;

export type { InsertOrganization, SelectOrganization };
export { OrganizationsTable };
