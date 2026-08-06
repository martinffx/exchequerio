import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "../Config";
import { type DrizzleDatabase, makeDatabaseTest } from "../database/Database";
import * as schema from "../repo/schema";
import { LedgersTable, OrganizationsTable } from "../repo/schema";
import {
	decodeOrganizationRow,
	type OrganizationRepo,
	OrganizationRepoTag,
	organizationRepoLayer,
} from "./OrganizationRepo";
import type { OrganizationId } from "./domain/OrganizationId";
import {
	OrganizationHasDependents,
	OrganizationPersistenceDecodingFailure,
} from "./domain/OrganizationErrors";

const newOrganizationId = (): OrganizationId => new TypeID("org").toString() as OrganizationId;
const newLedgerId = (): string => new TypeID("lgr").toString();

const row = {
	id: "org_01h2x3y4z5a6b7c8d9e0f1g2h3",
	name: "Example",
	description: JSON.parse("null") as unknown,
	created: new Date("2026-08-04T10:00:00.000Z"),
	updated: new Date("2026-08-04T11:00:00.000Z"),
};

describe("decodeOrganizationRow", () => {
	it("normalizes PostgreSQL rows into immutable UTC domain values", () => {
		const result = decodeOrganizationRow(row);

		expect(result._tag).toBe("Success");
		if (result._tag === "Failure") expect.fail("expected a decoded Organization");
		expect(result.value.description).toBeUndefined();
		expect(result.value.created).toBeInstanceOf(DateTime);
		expect(result.value.created.zoneName).toBe("UTC");
		expect(Object.isFrozen(result.value)).toBe(true);
	});

	it.each([
		{ ...row, id: "not-an-organization" },
		{ ...row, name: JSON.parse("null") as unknown },
		{ ...row, description: 42 },
		{ ...row, created: new Date("invalid") },
	])("returns a typed decoding failure for an invalid persisted row", invalidRow => {
		const result = decodeOrganizationRow(invalidRow);

		expect(result).toMatchObject({
			_tag: "Failure",
			error: { _tag: "OrganizationPersistenceDecodingFailure" },
		});
		if (result._tag === "Failure") {
			expect(result.error).toBeInstanceOf(OrganizationPersistenceDecodingFailure);
		}
	});
});

describe("OrganizationRepoLive", () => {
	let pool: Pool;
	let db: DrizzleDatabase;
	const organizationIds = new Set<OrganizationId>();
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
		return run(repository => repository.create({ id, name, description }));
	};

	beforeAll(() => {
		pool = new Pool({ connectionString: new Config().databaseUrl });
		db = drizzle(pool, { schema });
	});

	afterAll(async () => {
		for (const id of ledgerIds) await db.delete(LedgersTable).where(eq(LedgersTable.id, id));
		for (const id of organizationIds) {
			await db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id));
		}
		await pool.end();
	});

	it("orders lists by ID, paginates, and applies actor filtering in PostgreSQL", async () => {
		await create("Ordered A");
		const second = await create("Ordered B");

		const all = await run(repository =>
			repository.list({ scope: { _tag: "All" }, offset: 0, limit: 100 })
		);
		const allIds = all.map(organization => organization.id);
		expect(allIds).toEqual([...allIds].sort());
		const page = await run(repository =>
			repository.list({ scope: { _tag: "All" }, offset: 1, limit: 1 })
		);
		expect(page.map(organization => organization.id)).toEqual([all[1]?.id]);

		const scoped = await run(repository =>
			repository.list({
				scope: { _tag: "Organization", organizationId: second.id },
				offset: 0,
				limit: 1,
			})
		);
		expect(scoped.map(organization => organization.id)).toEqual([second.id]);
	});

	it("creates duplicate names with database timestamps", async () => {
		const first = await create("Duplicate allowed");
		const second = await create("Duplicate allowed");

		expect(first.id).not.toBe(second.id);
		expect(first.created.isValid).toBe(true);
		expect(first.created.zoneName).toBe("UTC");
		expect(first.updated.toMillis()).toBe(first.created.toMillis());
	});

	it("preserves or replaces descriptions and uses a database update timestamp", async () => {
		const organization = await create("Before", "Keep me");
		const preserved = await run(repository =>
			repository.update(organization.id, {
				name: "Preserved",
				description: { _tag: "Preserve" },
			})
		);
		expect(Option.getOrUndefined(preserved)?.description).toBe("Keep me");

		const replaced = await run(repository =>
			repository.update(organization.id, {
				name: "Replaced",
				description: { _tag: "Replace", value: "New description" },
			})
		);
		expect(Option.getOrUndefined(replaced)?.description).toBe("New description");
		expect(Option.getOrUndefined(replaced)?.updated.toMillis()).toBeGreaterThanOrEqual(
			organization.updated.toMillis()
		);
	});

	it("returns explicit absence for missing get, update, and delete", async () => {
		const id = newOrganizationId();
		const [found, updated, deleted] = await run(repository =>
			Effect.all([
				repository.get(id),
				repository.update(id, { name: "Missing", description: { _tag: "Preserve" } }),
				repository.delete(id),
			])
		);
		expect([found, updated, deleted].every(value => Option.isNone(value))).toBe(true);
	});

	it("gets an existing Organization and returns the deleted row before it becomes absent", async () => {
		const organization = await create("Get and delete", "Stored description");

		const found = await run(repository => repository.get(organization.id));
		expect(Option.getOrUndefined(found)).toEqual(organization);

		const deleted = await run(repository => repository.delete(organization.id));
		expect(Option.getOrUndefined(deleted)).toEqual(organization);
		expect(await run(repository => repository.get(organization.id))).toEqual(Option.none());
	});

	it("maps a real dependent Ledger delete to OrganizationHasDependents", async () => {
		const organization = await create("Dependent");
		const ledgerId = newLedgerId();
		ledgerIds.add(ledgerId);
		await db.insert(LedgersTable).values({
			id: ledgerId,
			organizationId: organization.id,
			name: "Dependent Ledger",
		});

		const error = await run(repository => Effect.flip(repository.delete(organization.id)));
		expect(error).toEqual(new OrganizationHasDependents(organization.id));
	});
});
