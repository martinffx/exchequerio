class InvalidOrganizationId {
	public readonly _tag = "InvalidOrganizationId";

	constructor(public readonly value: string) {}
}

class InvalidOrganizationDescriptionUpdate {
	public readonly _tag = "InvalidOrganizationDescriptionUpdate";
}

class OrganizationAccessDenied {
	public readonly _tag = "OrganizationAccessDenied";

	constructor(public readonly organizationId?: string) {}
}

class OrganizationNotFound {
	public readonly _tag = "OrganizationNotFound";

	constructor(public readonly organizationId: string) {}
}

class OrganizationHasDependents {
	public readonly _tag = "OrganizationHasDependents";

	constructor(public readonly organizationId: string) {}
}

class OrganizationRepositoryUnavailable {
	public readonly _tag = "OrganizationRepositoryUnavailable";

	constructor(public readonly cause: unknown) {}
}

class OrganizationPersistenceDecodingFailure {
	public readonly _tag = "OrganizationPersistenceDecodingFailure";

	constructor(public readonly cause: unknown) {}
}

class OrganizationPersistenceFailure {
	public readonly _tag = "OrganizationPersistenceFailure";

	constructor(public readonly cause: unknown) {}
}

export {
	InvalidOrganizationId,
	InvalidOrganizationDescriptionUpdate,
	OrganizationAccessDenied,
	OrganizationHasDependents,
	OrganizationNotFound,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
};
