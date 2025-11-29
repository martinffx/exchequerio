import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { range } from "radash";
import { Config } from "@/config";
import { ConflictError, NotFoundError } from "@/errors";
import * as schema from "@/repo/schema";
import { runMigrations } from "./migrations";
import { OrganizationEntity, OrganizationRepo } from "./OrganizationRepo";

describe("OrganizationRepo", () => {
	let pool: Pool;
	let repo: OrganizationRepo;

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
		let offset = 0;
		const limit = 100;
		let records: OrganizationEntity[] = [];
		do {
			records = await repo.listOrganizations(offset, limit);
			offset += limit;
			await Promise.all(records.map(r => repo.deleteOrganization(r.id)));
		} while (records.length === limit);
		await pool.end();
	});

	it("should create, read and delete record", async () => {
		const record = OrganizationEntity.fromRequest({
			name: "Test Organization",
			description: "Test description",
		});
		const rs = await repo.createOrganization(record);
		expect(record.id).toEqual(rs.id);
		expect(record.name).toEqual(rs.name);
		expect(record.description).toEqual(rs.description);

		const rs1 = await repo.getOrganization(rs.id);
		expect(rs).toEqual(rs1);

		void repo.deleteOrganization(rs.id);
		await expect(repo.getOrganization(rs.id)).rejects.toThrow(NotFoundError);
	});

	it("should not allow creating of duplicate records", async () => {
		const record = OrganizationEntity.fromRequest({
			name: "Test Organization",
			description: "Test description",
		});
		const rs = await repo.createOrganization(record);
		await expect(repo.createOrganization(record)).rejects.toThrow(ConflictError);
		await repo.deleteOrganization(rs.id);
	});

	it("should allow records to be updated", async () => {
		const record = OrganizationEntity.fromRequest({
			name: "Test Organization",
			description: "Test description",
		});
		await expect(repo.updateOrganization(record.id, record)).rejects.toThrow(NotFoundError);

		const rs = await repo.createOrganization(record);
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
		}
	});

	it("should paginate records", async () => {
		const records: Promise<OrganizationEntity>[] = [];
		for (const index of range(1, 50)) {
			const record = OrganizationEntity.fromRequest({
				name: `Test Organization ${index}`,
				description: `Test description ${index}`,
			});
			const rs = repo.createOrganization(record);
			records.push(rs);
		}
		const savedRecords = await Promise.all(records);

		try {
			const rs = await repo.listOrganizations(0, 20);
			expect(rs.length).toEqual(20);
			const rs1 = await repo.listOrganizations(20, 20);
			expect(rs1.length).toEqual(20);
			const rs2 = await repo.listOrganizations(40, 20);
			expect(rs2.length).toEqual(10);
		} finally {
			await Promise.all(savedRecords.map(record => repo.deleteOrganization(record.id)));
		}
	});
});
