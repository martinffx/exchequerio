import { TypeID } from "typeid-js";
import { InvalidOrganizationId } from "./organization-errors";

declare const organizationIdBrand: unique symbol;
type OrganizationId = string & { readonly [organizationIdBrand]: "OrganizationId" };

type OrganizationIdParseResult =
	| { readonly _tag: "Success"; readonly value: OrganizationId }
	| { readonly _tag: "Failure"; readonly error: InvalidOrganizationId };

const parseOrganizationId = (value: string): OrganizationIdParseResult => {
	try {
		const parsed = TypeID.fromString(value, "org").toString();
		if (parsed !== value) {
			return { _tag: "Failure", error: new InvalidOrganizationId(value) };
		}
		return { _tag: "Success", value: parsed as OrganizationId };
	} catch {
		return { _tag: "Failure", error: new InvalidOrganizationId(value) };
	}
};

export type { OrganizationId, OrganizationIdParseResult };
export { parseOrganizationId };
