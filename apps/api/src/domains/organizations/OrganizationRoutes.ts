import { Effect } from "effect";
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { requirePermissions } from "@/auth";
import type { OrgID } from "@/lib/ids";
import { parseId, runToCompletion } from "@/lib/utils";
import { OrganizationServiceTag } from "./OrganizationService";

// Organization routes are unscoped: the token's Organization is never used.
const OrganizationRoutes = HttpApiBuilder.group(LedgerApi, "organizations", handlers =>
	Effect.gen(function* () {
		const service = yield* OrganizationServiceTag;
		return handlers
			.handle("list", ({ query }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["organization:read"]);
					const organizations = yield* service.listOrganizations({
						offset: query.offset,
						limit: query.limit,
					});
					return organizations.map(organization => organization.toResponse());
				})
			)
			.handle("get", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["organization:read"]);
					const orgId = yield* parseId<"org", OrgID>("org", params.orgId);
					const organization = yield* service.getOrganization(orgId);
					return organization.toResponse();
				})
			)
			.handle(
				"create",
				({ payload }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["organization:write"]);
						const organization = yield* service.createOrganization(payload);
						return HttpApiSchema.withHeaders({
							body: organization.toResponse(),
							headers: { location: `/api/organizations/${organization.id.toString()}` },
						});
					}),
				runToCompletion
			)
			.handle(
				"update",
				({ params, payload }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["organization:write"]);
						const orgId = yield* parseId<"org", OrgID>("org", params.orgId);
						const organization = yield* service.updateOrganization(orgId, payload);
						return organization.toResponse();
					}),
				runToCompletion
			)
			.handle(
				"delete",
				({ params }) =>
					Effect.gen(function* () {
						yield* requirePermissions(["organization:delete"]);
						const orgId = yield* parseId<"org", OrgID>("org", params.orgId);
						yield* service.deleteOrganization(orgId);
					}),
				runToCompletion
			);
	})
);

export { OrganizationRoutes };
