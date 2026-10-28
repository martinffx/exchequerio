import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import {
	BadRequestApiError,
	ConflictApiError,
	ForbiddenApiError,
	InternalServerApiError,
	NotFoundApiError,
	ServiceUnavailableApiError,
	UnauthorizedApiError,
} from "@/lib/errors";
import {
	OrganizationCreateRequest,
	OrganizationIdParameters,
	OrganizationListQuery,
	OrganizationResponse,
	OrganizationUpdateRequest,
} from "./OrganizationSchema";

// Collection paths keep their trailing slash, as today's OpenAPI document has it.
// Authentication adds the 401 at the API level; it is declared per route here to match the contract.
const commonErrors = [
	BadRequestApiError,
	UnauthorizedApiError,
	ForbiddenApiError,
	InternalServerApiError,
	ServiceUnavailableApiError,
] as const;

const operation = (identifier: string, summary: string) =>
	OpenApi.annotations({ identifier, summary });

const OrganizationApi = HttpApiGroup.make("organizations")
	.add(
		HttpApiEndpoint.get("list", "/organizations/", {
			query: OrganizationListQuery,
			success: Schema.Array(OrganizationResponse),
			error: commonErrors,
		}).annotateMerge(operation("listOrganizations", "List Organizations")),
		HttpApiEndpoint.get("get", "/organizations/:orgId", {
			params: OrganizationIdParameters,
			success: OrganizationResponse,
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(operation("getOrganization", "Get an Organization")),
		HttpApiEndpoint.post("create", "/organizations/", {
			payload: OrganizationCreateRequest,
			success: HttpApiSchema.WithHeaders(OrganizationResponse.pipe(HttpApiSchema.status(201)), {
				location: Schema.String,
			}),
			error: commonErrors,
		}).annotateMerge(operation("createOrganization", "Create an Organization")),
		HttpApiEndpoint.put("update", "/organizations/:orgId", {
			params: OrganizationIdParameters,
			payload: OrganizationUpdateRequest,
			success: OrganizationResponse,
			error: [NotFoundApiError, ...commonErrors],
		}).annotateMerge(operation("updateOrganization", "Update an Organization")),
		HttpApiEndpoint.delete("delete", "/organizations/:orgId", {
			params: OrganizationIdParameters,
			success: HttpApiSchema.NoContent,
			error: [NotFoundApiError, ConflictApiError, ...commonErrors],
		}).annotateMerge(operation("deleteOrganization", "Delete an Organization"))
	)
	.annotateMerge(
		OpenApi.annotations({
			title: "Organizations",
			description: "An organization is a tenant on the platform.",
		})
	);

export { OrganizationApi };
