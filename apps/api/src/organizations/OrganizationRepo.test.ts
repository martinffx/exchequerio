import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { TypeID } from "typeid-js";
import { afterAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import type { OrgID } from "../repo/entities/types";
import { OrganizationsTable } from "../repo/schema";
import { Organization } from "./domain/Organization";
import { OrganizationPersistenceDecodingFailure } from "./domain/OrganizationErrors";
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

	const run = <A, E>(use: (repository: OrganizationRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(OrganizationRepoTag.pipe(Effect.flatMap(use)));
	const database = () => runtime.runPromise(DatabaseTag);

	const create = (name: string, description?: string) => {
		const id = newOrganizationId();
		organizationIds.add(id);
		const organization = Organization.fromRequest(id, {
			name,
			description,
		});
		return run(repository => repository.createOrganization(organization));
	};

	afterAll(async () => {
		try {
			await run(repository =>
				Effect.forEach(organizationIds, id => repository.deleteOrganization(id), { discard: true })
			);
		} finally {
			await runtime.dispose();
		}
	});

	it("orders lists by ID and applies pagination limits in PostgreSQL", async () => {
		await create("Ordered A");
		await create("Ordered B");

		const all = await run(repository => repository.listOrganizations({ offset: 0, limit: 100 }));
		const allIds = all.map(organization => organization.id.toString());
		expect(allIds).toEqual([...allIds].sort());
		const page = await run(repository => repository.listOrganizations({ offset: 1, limit: 1 }));
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
		const first = await run(repository => repository.createOrganization(firstRecord));
		const second = await run(repository => repository.createOrganization(secondRecord));

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

		const created = await run(repository => repository.createOrganization(record));

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
			await run(repository => repository.updateOrganization(replacement))
		);

		expect(updated.description).toBe(description);
		expect(updated.created.toMillis()).toBe(organization.created.toMillis());
		expect(updated.updated.toMillis()).toBe(replacement.updated.toMillis());
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

	it.each(["not-an-organization", "lgr_01h2x3y4z5a6b7c8d9e0f1g2h3"])(
		"returns a typed decoding failure for schema-valid Organization ID %s",
		async invalidId => {
			const db = (await database()).db;
			await db.insert(OrganizationsTable).values({
				id: invalidId,
				name: "Malformed Organization",
				created: new Date("2026-08-04T10:00:00.000Z"),
				updated: new Date("2026-08-04T11:00:00.000Z"),
			});

			try {
				const error = await run(repository =>
					Effect.flip(repository.getOrganization(invalidId as unknown as OrgID))
				);
				expect(error).toBeInstanceOf(OrganizationPersistenceDecodingFailure);
			} finally {
				await db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, invalidId));
			}
		}
	);
});
