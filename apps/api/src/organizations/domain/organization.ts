import type { DateTime } from "luxon";
import type { OrganizationId } from "./organization-id";
import { InvalidOrganizationDescriptionUpdate } from "./organization-errors";

interface Organization {
	readonly id: OrganizationId;
	readonly name: string;
	readonly description?: string;
	readonly created: DateTime;
	readonly updated: DateTime;
}

interface CreateOrganizationInput {
	readonly name: string;
	readonly description?: string;
}

interface OrganizationUpdateRequest {
	readonly name: string;
	readonly description?: string;
}

type OrganizationDescriptionUpdate =
	| { readonly _tag: "Preserve" }
	| { readonly _tag: "Replace"; readonly value: string };

interface UpdateOrganizationInput {
	readonly name: string;
	readonly description: OrganizationDescriptionUpdate;
}

type OrganizationUpdateInputResult =
	| { readonly _tag: "Success"; readonly value: UpdateOrganizationInput }
	| { readonly _tag: "Failure"; readonly error: InvalidOrganizationDescriptionUpdate };

interface OrganizationFields extends CreateOrganizationInput {
	readonly id: OrganizationId;
	readonly created: DateTime;
	readonly updated: DateTime;
}

const createOrganization = (fields: OrganizationFields): Organization =>
	Object.freeze({
		...fields,
		created: fields.created.toUTC(),
		updated: fields.updated.toUTC(),
	});

const parseOrganizationUpdateInput = (
	request: OrganizationUpdateRequest
): OrganizationUpdateInputResult => {
	if (Object.hasOwn(request, "description") && request.description === undefined) {
		return { _tag: "Failure", error: new InvalidOrganizationDescriptionUpdate() };
	}
	return {
		_tag: "Success",
		value: {
			name: request.name,
			description:
				request.description === undefined
					? { _tag: "Preserve" }
					: { _tag: "Replace", value: request.description },
		},
	};
};

const updateOrganization = (
	organization: Organization,
	input: UpdateOrganizationInput,
	updated: DateTime
): Organization =>
	createOrganization({
		...organization,
		name: input.name,
		...(input.description._tag === "Replace" ? { description: input.description.value } : {}),
		updated,
	});

export type {
	CreateOrganizationInput,
	Organization,
	OrganizationDescriptionUpdate,
	OrganizationFields,
	OrganizationUpdateInputResult,
	OrganizationUpdateRequest,
	UpdateOrganizationInput,
};
export { createOrganization, parseOrganizationUpdateInput, updateOrganization };
