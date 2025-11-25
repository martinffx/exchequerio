import type { LedgerEntity, OrganizationEntity } from "./entities"
import type { OrganizationRepo } from "@/repo/OrganizationRepo"
import { TypeID } from "typeid-js"

class OrganizationService {
	constructor(private readonly orgRepo: OrganizationRepo) {}

	public async getOrganization(id: string): Promise<OrganizationEntity> {
		const orgId = TypeID.fromString<"org">(id)
		return this.orgRepo.getOrganization(orgId)
	}

	public async listOrganizations(offset: number, limit: number): Promise<OrganizationEntity[]> {
		return this.orgRepo.listOrganizations(offset, limit)
	}

	public async createOrganization(entity: OrganizationEntity): Promise<OrganizationEntity> {
		return this.orgRepo.createOrganization(entity)
	}

	public async updateOrganization(
		id: string,
		entity: OrganizationEntity
	): Promise<OrganizationEntity> {
		const orgId = TypeID.fromString<"org">(id)
		return this.orgRepo.updateOrganization(orgId, entity)
	}

	public async deleteOrganization(id: string): Promise<void> {
		const orgId = TypeID.fromString<"org">(id)
		return this.orgRepo.deleteOrganization(orgId)
	}
}

export { OrganizationService }
