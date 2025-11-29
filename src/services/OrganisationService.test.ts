import { vi } from "vitest";
import { range } from "radash";
import { NotFoundError } from "@/errors";
import { OrganizationEntity, type OrganizationRepo } from "@/repo/OrganizationRepo";
import { OrganizationService } from "./OrganizationService";

describe("OrganizationService", () => {
	const mockRepo = vi.mocked<OrganizationRepo>({
		createOrganization: vi.fn().mockReturnThis(),
		getOrganization: vi.fn().mockReturnThis(),
		updateOrganization: vi.fn().mockReturnThis(),
		deleteOrganization: vi.fn().mockReturnThis(),
		listOrganizations: vi.fn().mockReturnThis(),
	} as unknown as OrganizationRepo);
	let organizationService: OrganizationService;

	beforeAll(() => {
		organizationService = new OrganizationService(mockRepo);
	});

	afterEach(() => {
		jest.resetAllMocks();
	});

	it("should list and paginate organizations ", async () => {
		mockRepo.listOrganizations.mockImplementation((offset, limit) => {
			return Promise.resolve(
				(() => {
					const records = [];
					for (const index of range(offset ?? 0, (offset ?? 0) + (limit ?? 10) - 1)) {
						if (index >= 50) {
							return records;
						}
						records.push(
							OrganizationEntity.fromRequest({
								name: `Test Organization ${index}`,
								description: `Test description ${index}`,
							})
						);
					}
					return records;
				})()
			);
		});
		const rs = await organizationService.listOrganizations(0, 20);
		expect(rs.length).toEqual(20);
		const rs1 = await organizationService.listOrganizations(20, 20);
		expect(rs1.length).toEqual(20);
		const rs2 = await organizationService.listOrganizations(40, 20);
		expect(rs2.length).toEqual(10);
	});

	it("should create, update and delete an organization", async () => {
		const record = OrganizationEntity.fromRequest({
			name: "Test Organization",
			description: "Test description",
		});
		mockRepo.createOrganization.mockImplementationOnce(entity => Promise.resolve(entity));
		mockRepo.getOrganization.mockImplementationOnce(id => {
			expect(id).toEqual(record.id);
			return Promise.resolve(record);
		});
		mockRepo.getOrganization.mockImplementationOnce(id => {
			expect(id).toEqual(record.id);
			throw new NotFoundError(`Organization with id ${id.toString()} not found`);
		});
		mockRepo.updateOrganization.mockImplementationOnce((id, entity) => {
			expect(id).toEqual(entity.id);
			return Promise.resolve(entity);
		});
		mockRepo.deleteOrganization.mockImplementation(_id => {
			return Promise.resolve();
		});

		const rs = await organizationService.createOrganization(record);
		expect(record.id).toEqual(rs.id);
		expect(record.name).toEqual(rs.name);
		expect(record.description).toEqual(rs.description);

		const rs1 = await organizationService.getOrganization(rs.id.toString());
		expect(rs).toEqual(rs1);

		const rs2 = await organizationService.updateOrganization(
			rs.id.toString(),
			OrganizationEntity.fromRequest(
				{
					name: "Updated Name",
					description: "Updated Description",
				},
				rs.id.toString()
			)
		);
		expect(rs2.id).toEqual(rs1.id);

		void organizationService.deleteOrganization(rs.id.toString());
		void expect(organizationService.getOrganization(rs.id.toString())).rejects.toThrow(NotFoundError);

		expect(mockRepo.createOrganization).toHaveBeenCalledTimes(1);
		expect(mockRepo.getOrganization).toHaveBeenCalledTimes(2);
		expect(mockRepo.updateOrganization).toHaveBeenCalledTimes(1);
		expect(mockRepo.deleteOrganization).toHaveBeenCalledTimes(1);
	});
});
