import { OrganizationEntity, type OrganizationRepo } from "@/repo/OrganizationRepo"
import { OrganizationService } from "./OrganizationService"
import { range } from "radash"
import { NotFoundError } from "@/errors"

describe("OrganizationService", () => {
	const mockRepo = jest.mocked<OrganizationRepo>({
		createOrganization: jest.fn(),
		getOrganization: jest.fn(),
		updateOrganization: jest.fn(),
		deleteOrganization: jest.fn(),
		listOrganizations: jest.fn(),
	} as unknown as OrganizationRepo)
	let organizationService: OrganizationService

	beforeAll(async () => {
		organizationService = new OrganizationService(mockRepo)
	})

	afterEach(async () => {
		jest.resetAllMocks()
	})

	it("should list and paginate organizations ", async () => {
		mockRepo.listOrganizations.mockImplementation(async (offset, limit) => {
			const records = []
			for (const i of range(offset ?? 0, (offset ?? 0) + (limit ?? 10) - 1)) {
				if (i >= 50) {
					return records
				}
				records.push(
					OrganizationEntity.fromRequest({
						name: `Test Organization ${i}`,
						description: `Test description ${i}`,
					})
				)
			}
			return records
		})
		const rs = await organizationService.listOrganizations(0, 20)
		expect(rs.length).toEqual(20)
		const rs1 = await organizationService.listOrganizations(20, 20)
		expect(rs1.length).toEqual(20)
		const rs2 = await organizationService.listOrganizations(40, 20)
		expect(rs2.length).toEqual(10)
	})

	it("should create, update and delete an organization", async () => {
		const record = OrganizationEntity.fromRequest({
			name: "Test Organization",
			description: "Test description",
		})
		mockRepo.createOrganization.mockImplementationOnce(async entity => entity)
		mockRepo.getOrganization.mockImplementationOnce(async id => {
			expect(id).toEqual(record.id)
			return record
		})
		mockRepo.getOrganization.mockImplementationOnce(async id => {
			expect(id).toEqual(record.id)
			throw new NotFoundError(`Organization with id ${id} not found`)
		})
		mockRepo.updateOrganization.mockImplementationOnce(async (id, entity) => {
			expect(id).toEqual(entity.id)
			expect(entity.id).toEqual(record.id)
			expect(entity.name).toEqual("Updated Name")
			expect(entity.description).toEqual("Updated Description")
			return entity
		})
		mockRepo.deleteOrganization.mockImplementation(async id => {
			return
		})

		const rs = await organizationService.createOrganization(record)
		expect(record.id).toEqual(rs.id)
		expect(record.name).toEqual(rs.name)
		expect(record.description).toEqual(rs.description)

		const rs1 = await organizationService.getOrganization(rs.id.toString())
		expect(rs).toEqual(rs1)

		const rs2 = await organizationService.updateOrganization(
			rs.id.toString(),
			OrganizationEntity.fromRequest(
				{
					name: "Updated Name",
					description: "Updated Description",
				},
				rs.id.toString()
			)
		)
		expect(rs2.id).toEqual(rs1.id)

		await organizationService.deleteOrganization(rs.id.toString())
		expect(organizationService.getOrganization(rs.id.toString())).rejects.toThrow(NotFoundError)

		expect(mockRepo.createOrganization).toHaveBeenCalledTimes(1)
		expect(mockRepo.getOrganization).toHaveBeenCalledTimes(2)
		expect(mockRepo.updateOrganization).toHaveBeenCalledTimes(1)
		expect(mockRepo.deleteOrganization).toHaveBeenCalledTimes(1)
	})
})
