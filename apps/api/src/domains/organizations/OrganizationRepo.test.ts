import { eq, sql } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import type { OrgID } from "@/lib/ids";
import { OrganizationsTable } from "../../db/schema";
import { Organization } from "./Organization";
import {
	type OrganizationRepo,
	OrganizationRepoTag,
	organizationRepoLayer,
} from "./OrganizationRepo";

const newOrganizationId = (): OrgID => new TypeID("org");

describe("OrganizationRepoLive", () => {
	const organizationIds = new Set<OrgID>();

	const organizationRepoLive = organizationRepoLayer.pipe(
		Layer.provideMerge(makeDatabaseLive(new Config().databaseUrl))
	);

	const runtime: ManagedRuntime.ManagedRuntime<Database | OrganizationRepo, never> =
		ManagedRuntime.make(organizationRepoLive);

	let repository: OrganizationRepo;
	let database: Database;

	beforeAll(async () => {
		repository = await runtime.runPromise(OrganizationRepoTag);
		database = await runtime.runPromise(DatabaseTag);
	});

	const create = (name: string, description?: string) => {
		const id = newOrganizationId();
		organizationIds.add(id);
		const organization = Organization.fromRequest(id, {
			name,
			description,
		});
		return runtime.runPromise(repository.createOrganization(organization));
	};

	afterAll(async () => {
		try {
			await runtime.runPromise(
				Effect.forEach(organizationIds, id => repository.deleteOrganization(id), { discard: true })
			);
		} finally {
			await runtime.dispose();
		}
	});

	it("stores the embedded UUID and restores the same public TypeID", async () => {
		const organization = await create("UUID storage");
		const rows = await database.db
			.select()
			.from(OrganizationsTable)
			.where(eq(OrganizationsTable.id, organization.id.toUUID()));
		expect(rows[0]?.id).toBe(organization.id.toUUID());
		const restored = Option.getOrThrow(
			await runtime.runPromise(repository.getOrganization(organization.id))
		);
		expect(restored.toResponse().id).toBe(organization.id.toString());
		const columns = await database.db.execute<{
			table_name: string;
			column_name: string;
			data_type: string;
		}>(sql`
			SELECT table_name, column_name, data_type FROM information_schema.columns
			WHERE table_schema = 'public' AND (column_name = 'id' OR right(column_name, 3) = '_id')
		`);
		expect(columns.rows.length).toBeGreaterThan(0);
		expect(columns.rows.filter(column => column.data_type !== "uuid")).toEqual([]);
	});

	it("orders lists by ID and applies pagination limits in PostgreSQL", async () => {
		await create("Ordered A");
		await create("Ordered B");

		const all = await runtime.runPromise(repository.listOrganizations({ offset: 0, limit: 100 }));
		const allIds = all.map(organization => organization.id.toString());
		expect(allIds).toEqual([...allIds].sort());
		const page = await runtime.runPromise(repository.listOrganizations({ offset: 1, limit: 1 }));
		expect(page).toHaveLength(1);
	});

	it("creates duplicate names with application timestamps", async () => {
		const firstRecord = Organization.fromRequest(newOrganizationId(), {
			name: "Duplicate allowed",
		});
		const secondRecord = Organization.fromRequest(newOrganizationId(), {
			name: "Duplicate allowed",
		});
		organizationIds.add(firstRecord.id);
		organizationIds.add(secondRecord.id);
		const first = await runtime.runPromise(repository.createOrganization(firstRecord));
		const second = await runtime.runPromise(repository.createOrganization(secondRecord));

		expect(first.id).not.toBe(second.id);
		expect(first.created.toMillis()).toBe(firstRecord.created.toMillis());
		expect(first.updated.toMillis()).toBe(firstRecord.updated.toMillis());
		expect(second.created.toMillis()).toBe(secondRecord.created.toMillis());
		expect(second.updated.toMillis()).toBe(secondRecord.updated.toMillis());
	});

	it.each([
		["stores", "Stored description"],
		["omits", undefined],
	] as const)("%s an optional description on create", async (_label, description) => {
		const record = Organization.fromRequest(newOrganizationId(), {
			name: `Create ${String(description)}`,
			description,
		});
		organizationIds.add(record.id);

		const created = await runtime.runPromise(repository.createOrganization(record));

		expect(created.description).toBe(description);
		expect(created.created.toMillis()).toBe(record.created.toMillis());
		expect(created.updated.toMillis()).toBe(record.updated.toMillis());
	});

	it.each([
		["replaces", "New description"],
		["clears", undefined],
	] as const)("%s an optional description on update", async (_label, description) => {
		const organization = await create(`Before ${String(description)}`, "Keep me");
		const replacement = Organization.fromRequest(organization.id, {
			name: "Replaced",
			description,
		});

		const updated = Option.getOrThrow(
			await runtime.runPromise(repository.updateOrganization(replacement))
		);

		expect(updated.description).toBe(description);
		expect(updated.created.toMillis()).toBe(organization.created.toMillis());
		expect(updated.updated.toMillis()).toBe(replacement.updated.toMillis());
	});

	it("returns explicit absence for missing get, update, and delete", async () => {
		const id = newOrganizationId();
		const update = Organization.fromRequest(id, { name: "Missing" });
		const [found, updated, deleted] = await runtime.runPromise(
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

		const found = await runtime.runPromise(repository.getOrganization(organization.id));
		expect(Option.getOrUndefined(found)).toEqual(organization);

		const deleted = await runtime.runPromise(repository.deleteOrganization(organization.id));
		expect(Option.getOrUndefined(deleted)).toEqual(organization);
		expect(await runtime.runPromise(repository.getOrganization(organization.id))).toEqual(
			Option.none()
		);
	});

	it.each(["not-an-organization", "lgr_01h2x3y4z5a6b7c8d9e0f1g2h3"])(
		"rejects non-UUID ID %s in PostgreSQL",
		async invalidId => {
			await expect(
				database.db.insert(OrganizationsTable).values({
					id: invalidId,
					name: "Malformed Organization",
				})
			).rejects.toMatchObject({ cause: { code: "22P02" } });
		}
	);
});
