import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer, Option } from "effect";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "../Config";
import { type DrizzleDatabase, makeDatabaseTest } from "../db/Database";
import type { OrgID } from "../repo/entities/types";
import * as schema from "../repo/schema";
import { LedgersTable, OrganizationsTable } from "../repo/schema";
import { Organization } from "./domain/Organization";
import { OrganizationHasDependents } from "./domain/OrganizationErrors";
import {
	type OrganizationRepo,
	OrganizationRepoTag,
	organizationRepoLayer,
} from "./OrganizationRepo";

const newOrganizationId = (): OrgID => new TypeID("org");
const newLedgerId = (): string => new TypeID("lgr").toString();

describe("OrganizationRepoLive", () => {
	let pool: Pool;
	let db: DrizzleDatabase;
	const organizationIds = new Set<OrgID>();
	const ledgerIds = new Set<string>();

	const run = <A, E>(use: (repository: OrganizationRepo) => Effect.Effect<A, E>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* use(yield* OrganizationRepoTag);
			}).pipe(Effect.provide(organizationRepoLayer.pipe(Layer.provide(makeDatabaseTest(db)))))
		);

	const create = (name: string, description?: string) => {
		const id = newOrganizationId();
		organizationIds.add(id);
		const organization = Organization.fromRequest(id, {
			name,
			...(description === undefined ? {} : { description }),
		});
		return run(repository => repository.createOrganization(organization));
	};

	beforeAll(() => {
		pool = new Pool({ connectionString: new Config().databaseUrl });
		db = drizzle(pool, { schema });
	});

	afterAll(async () => {
		for (const id of ledgerIds) await db.delete(LedgersTable).where(eq(LedgersTable.id, id));
		for (const id of organizationIds) {
			await db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id.toString()));
		}
		await pool.end();
	});

	it("orders lists by ID and paginates in PostgreSQL", async () => {
		await create("Ordered A");
		await create("Ordered B");

		const all = await run(repository => repository.listOrganizations({ offset: 0, limit: 100 }));
		const allIds = all.map(organization => organization.id.toString());
		expect(allIds).toEqual([...allIds].sort());
		const page = await run(repository => repository.listOrganizations({ offset: 1, limit: 1 }));
		expect(page.map(organization => organization.id.toString())).toEqual([all[1]?.id.toString()]);
	});

	it("creates duplicate names with database timestamps", async () => {
		const first = await create("Duplicate allowed");
		const second = await create("Duplicate allowed");

		expect(first.id).not.toBe(second.id);
		expect(first.created.isValid).toBe(true);
		expect(first.created.zoneName).toBe("UTC");
		expect(first.updated.toMillis()).toBe(first.created.toMillis());
	});

	it("replaces and clears descriptions while preserving created", async () => {
		const organization = await create("Before", "Keep me");
		const replacement = Organization.fromRequest(organization.id, {
			name: "Replaced",
			description: "New description",
		});
		const replaced = await run(repository => repository.updateOrganization(replacement));
		expect(Option.getOrUndefined(replaced)?.description).toBe("New description");

		const clearing = Organization.fromRequest(organization.id, { name: "Cleared" });
		const cleared = await run(repository => repository.updateOrganization(clearing));
		expect(Option.getOrUndefined(cleared)?.description).toBeUndefined();
		expect(Option.getOrUndefined(cleared)?.created.toMillis()).toBe(organization.created.toMillis());
		expect(Option.getOrUndefined(cleared)?.updated.toMillis()).toBe(clearing.updated.toMillis());
	});

	it("returns explicit absence for missing get, update, and delete", async () => {
		const id = newOrganizationId();
		const update = Organization.fromRequest(id, { name: "Missing" });
		const [found, updated, deleted] = await run(repository =>
			Effect.all([
				repository.getOrganization(id),
				repository.updateOrganization(update),
				repository.deleteOrganization(id),
			])
		);
		expect([found, updated, deleted].every(value => Option.isNone(value))).toBe(true);
	});

	it("gets an existing Organization and returns the deleted row before it becomes absent", async () => {
		const organization = await create("Get and delete", "Stored description");

		const found = await run(repository => repository.getOrganization(organization.id));
		expect(Option.getOrUndefined(found)).toEqual(organization);

		const deleted = await run(repository => repository.deleteOrganization(organization.id));
		expect(Option.getOrUndefined(deleted)).toEqual(organization);
		expect(await run(repository => repository.getOrganization(organization.id))).toEqual(
			Option.none()
		);
	});

	it("maps a real dependent Ledger delete to OrganizationHasDependents", async () => {
		const organization = await create("Dependent");
		const ledgerId = newLedgerId();
		ledgerIds.add(ledgerId);
		await db.insert(LedgersTable).values({
			id: ledgerId,
			organizationId: organization.id.toString(),
			name: "Dependent Ledger",
		});

		const error = await run(repository =>
			Effect.flip(repository.deleteOrganization(organization.id))
		);
		expect(error).toEqual(new OrganizationHasDependents(organization.id.toString()));
	});
});
