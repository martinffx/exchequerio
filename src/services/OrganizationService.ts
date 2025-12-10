import { TypeID } from "typeid-js";
import { OrganizationEntity } from "@/repo/entities";
import type { OrganizationRepo } from "@/repo/OrganizationRepo";

interface OrganizationRequest {
	name: string;
	description?: string;
}

class OrganizationService {
	constructor(private readonly orgRepo: OrganizationRepo) {}

	public async getOrganization(id: string): Promise<OrganizationEntity> {
		const orgId = TypeID.fromString<"org">(id);
		return this.orgRepo.getOrganization(orgId);
	}

	public async listOrganizations(offset: number, limit: number): Promise<OrganizationEntity[]> {
		return this.orgRepo.listOrganizations(offset, limit);
	}

	public async createOrganization(request: OrganizationRequest): Promise<OrganizationEntity> {
		const entity = OrganizationEntity.fromRequest(request);
		return this.orgRepo.createOrganization(entity);
	}

	public async updateOrganization(
		id: string,
		request: OrganizationRequest
	): Promise<OrganizationEntity> {
		const orgId = TypeID.fromString<"org">(id);
		const entity = OrganizationEntity.fromRequest(request, id);
		return this.orgRepo.updateOrganization(orgId, entity);
	}

	public async deleteOrganization(id: string): Promise<void> {
		const orgId = TypeID.fromString<"org">(id);
		return this.orgRepo.deleteOrganization(orgId);
	}
}

export { OrganizationService };
