import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { range } from "radash";
import { TypeID } from "typeid-js";
import { Config } from "@/config";
import { ConflictError, NotFoundError } from "@/errors";
import * as schema from "@/repo/schema";
import { runMigrations } from "./migrations";
import { OrganizationEntity, OrganizationRepo } from "./OrganizationRepo";

describe("OrganizationRepo", () => {
	let pool: Pool;
	let repo: OrganizationRepo;
	const createdOrganizations: Set<string> = new Set();

	beforeAll(async () => {
		const config = new Config();
		pool = new Pool({
			connectionString: config.databaseUrl,
		});
		const database = drizzle(pool, { schema });
		repo = new OrganizationRepo(database);
		await runMigrations(database);
	});

	afterAll(async () => {
		// Only delete organizations created by this test file
		for (const orgId of createdOrganizations) {
			try {
				await repo.deleteOrganization(TypeID.fromString<"org">(orgId));
			} catch {
				// Ignore errors if organization was already deleted
			}
		}
		await pool.end();
	});

	it("should create, read and delete record", async () => {
		const record = OrganizationEntity.fromRequest({
			name: "Test Organization",
			description: "Test description",
		});
		const rs = await repo.createOrganization(record);
		createdOrganizations.add(rs.id.toString());

		expect(record.id).toEqual(rs.id);
		expect(record.name).toEqual(rs.name);
		expect(record.description).toEqual(rs.description);

		const rs1 = await repo.getOrganization(rs.id);
		expect(rs).toEqual(rs1);

		await repo.deleteOrganization(rs.id);
		createdOrganizations.delete(rs.id.toString());
		await expect(repo.getOrganization(rs.id)).rejects.toThrow(NotFoundError);
	});

	it("should not allow creating of duplicate records", async () => {
		const record = OrganizationEntity.fromRequest({
			name: "Test Organization",
			description: "Test description",
		});
		const rs = await repo.createOrganization(record);
		createdOrganizations.add(rs.id.toString());

		await expect(repo.createOrganization(record)).rejects.toThrow(ConflictError);

		await repo.deleteOrganization(rs.id);
		createdOrganizations.delete(rs.id.toString());
	});

	it("should allow records to be updated", async () => {
		const record = OrganizationEntity.fromRequest({
			name: "Test Organization",
			description: "Test description",
		});
		await expect(repo.updateOrganization(record.id, record)).rejects.toThrow(NotFoundError);

		const rs = await repo.createOrganization(record);
		createdOrganizations.add(rs.id.toString());

		try {
			const updatedRecord = record.update({
				name: "Test Organization Updated",
				description: "Test description updated",
			});
			const rs1 = await repo.updateOrganization(updatedRecord.id, updatedRecord);

			expect(rs1.id).toEqual(rs.id);

			expect(rs1.name).toEqual(updatedRecord.name);
			expect(rs1.description).toEqual(updatedRecord.description);
		} finally {
			await repo.deleteOrganization(rs.id);
			createdOrganizations.delete(rs.id.toString());
		}
	});

	it("should paginate records", async () => {
		const records: Promise<OrganizationEntity>[] = [];
		for (const index of range(1, 50)) {
			const record = OrganizationEntity.fromRequest({
				name: `Test Organization Pagination ${index}`,
				description: `Test description ${index}`,
			});
			const rs = repo.createOrganization(record);
			records.push(rs);
		}
		const savedRecords = await Promise.all(records);
		for (const record of savedRecords) {
			createdOrganizations.add(record.id.toString());
		}

		try {
			// Get all organizations and filter to only our test records
			const allOrgs = await repo.listOrganizations(0, 100);
			const ourOrgs = allOrgs.filter(org => org.name.startsWith("Test Organization Pagination"));

			expect(ourOrgs.length).toEqual(50);

			// Test pagination with a fresh query for our specific records
			const rs = await repo.listOrganizations(0, 20);
			expect(rs.length).toBeGreaterThanOrEqual(20);

			const rs1 = await repo.listOrganizations(20, 20);
			expect(rs1.length).toBeGreaterThanOrEqual(10);
		} finally {
			await Promise.all(savedRecords.map(record => repo.deleteOrganization(record.id)));
			for (const record of savedRecords) {
				createdOrganizations.delete(record.id.toString());
			}
		}
	});
});
