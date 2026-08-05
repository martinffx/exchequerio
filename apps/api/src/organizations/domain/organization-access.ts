import type { OrganizationId } from "./organization-id";

interface OrganizationAccessCapabilities {
	readonly platform: boolean;
	readonly current: boolean;
}

type OrganizationAccessMode = "platform" | "current";
type OrganizationAccessDecision = OrganizationAccessMode | "denied";
type OrganizationListScope =
	| { readonly _tag: "All" }
	| { readonly _tag: "Organization"; readonly organizationId: OrganizationId };

const decideOrganizationAccess = ({
	platform,
	current,
}: OrganizationAccessCapabilities): OrganizationAccessDecision => {
	if (platform) return "platform";
	if (current) return "current";
	return "denied";
};

const organizationTargetAllowed = (
	access: OrganizationAccessMode,
	actorId: OrganizationId,
	targetId: OrganizationId
): boolean => access === "platform" || actorId === targetId;

const organizationListScope = (
	access: OrganizationAccessMode,
	actorId: OrganizationId
): OrganizationListScope =>
	access === "platform" ? { _tag: "All" } : { _tag: "Organization", organizationId: actorId };

export type {
	OrganizationAccessCapabilities,
	OrganizationAccessDecision,
	OrganizationAccessMode,
	OrganizationListScope,
};
export { decideOrganizationAccess, organizationListScope, organizationTargetAllowed };
