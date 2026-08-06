import {
	decideOrganizationAccess,
	type OrganizationAccessDecision,
} from "./domain/OrganizationAccess";

type OrganizationOperation = "read" | "create" | "update" | "delete";

const resolveOrganizationAccess = (
	permissions: ReadonlySet<string>,
	operation: OrganizationOperation
): OrganizationAccessDecision => {
	const platform = permissions.has(
		operation === "read" ? "organization:read" : "organization:write"
	);
	const current =
		operation !== "create" &&
		permissions.has(operation === "read" ? "my:organization:read" : "my:organization:write");
	return decideOrganizationAccess({ platform, current });
};

export type { OrganizationOperation };
export { resolveOrganizationAccess };
