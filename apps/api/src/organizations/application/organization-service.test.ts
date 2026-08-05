import { Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationId } from "../domain/organization-id";
import { createOrganization, type UpdateOrganizationInput } from "../domain/organization";
import {
	OrganizationAccessDenied,
	OrganizationHasDependents,
	OrganizationNotFound,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "../domain/organization-errors";
import type {
	OrganizationCreateRecord,
	OrganizationInfrastructureError,
	OrganizationRepositoryShape,
} from "./organization-repository";
import {
	OrganizationService,
	OrganizationServiceLive,
	type OrganizationCreateError,
	type OrganizationDeleteError,
	type OrganizationGetError,
	type OrganizationListError,
	type OrganizationUpdateError,
} from "./organization-service";
import {
	makeOrganizationIdGeneratorTest,
	makeOrganizationRepositoryTest,
} from "./organization-test-layers";

const actorId = "org_01h2x3y4z5a6b7c8d9e0f1g2h3" as OrganizationId;
const targetId = "org_01h2x3y4z5a6b7c8d9e0f1g2h4" as OrganizationId;
const generatedId = "org_01h2x3y4z5a6b7c8d9e0f1g2h5" as OrganizationId;
const timestamp = DateTime.fromISO("2026-08-04T10:00:00.000Z", { zone: "utc" });
const preserveDescription: UpdateOrganizationInput = {
	name: "Updated",
	description: { _tag: "Preserve" },
};
const organization = createOrganization({
	id: targetId,
	name: "Example",
	created: timestamp,
	updated: timestamp,
});
const organizationList = [organization];
const someOrganization = Option.fromNullishOr(organization);
const infrastructureFailures = [
	new OrganizationRepositoryUnavailable(new Error("unavailable")),
	new OrganizationPersistenceDecodingFailure(new Error("invalid row")),
	new OrganizationPersistenceFailure(new Error("query failed")),
];

const repository = (
	overrides: Partial<OrganizationRepositoryShape> = {}
): OrganizationRepositoryShape => ({
	list: vi.fn(() => Effect.succeed(organizationList)),
	get: vi.fn(() => Effect.succeed(someOrganization)),
	create: vi.fn((input: OrganizationCreateRecord) =>
		Effect.succeed(
			createOrganization({
				...input,
				created: timestamp,
				updated: timestamp,
			})
		)
	),
	update: vi.fn(() => Effect.succeed(someOrganization)),
	delete: vi.fn(() => Effect.succeed(someOrganization)),
	...overrides,
});

const runService = <A, E>(
	repositoryImplementation: OrganizationRepositoryShape,
	use: (service: OrganizationService["Service"]) => Effect.Effect<A, E>
) => {
	const dependencies = Layer.merge(
		makeOrganizationRepositoryTest(repositoryImplementation),
		makeOrganizationIdGeneratorTest(generatedId)
	);
	return Effect.runPromise(
		Effect.gen(function* () {
			return yield* use(yield* OrganizationService);
		}).pipe(Effect.provide(OrganizationServiceLive.pipe(Layer.provide(dependencies))))
	);
};

describe("OrganizationService", () => {
	it("lists every Organization for platform access", async () => {
		const repo = repository();

		await runService(repo, service =>
			service.list({ actorId, access: "platform", offset: 10, limit: 5 })
		);

		expect(repo.list).toHaveBeenCalledWith({
			scope: { _tag: "All" },
			offset: 10,
			limit: 5,
		});
	});

	it("passes actor scope to the repository for current access", async () => {
		const repo = repository();

		await runService(repo, service =>
			service.list({ actorId, access: "current", offset: 0, limit: 20 })
		);

		expect(repo.list).toHaveBeenCalledWith({
			scope: { _tag: "Organization", organizationId: actorId },
			offset: 0,
			limit: 20,
		});
	});

	it.each(["get", "update", "delete"] as const)(
		"denies a current-Organization %s mismatch before repository invocation",
		async operation => {
			const repo = repository();
			const error = await Effect.runPromise(
				Effect.flip(
					Effect.gen(function* () {
						const service = yield* OrganizationService;
						if (operation === "get") {
							return yield* service.get({ actorId, access: "current", targetId });
						}
						if (operation === "update") {
							return yield* service.update({
								actorId,
								access: "current",
								targetId,
								input: preserveDescription,
							});
						}
						return yield* service.delete({ actorId, access: "current", targetId });
					}).pipe(
						Effect.provide(
							OrganizationServiceLive.pipe(
								Layer.provide(
									Layer.merge(
										makeOrganizationRepositoryTest(repo),
										makeOrganizationIdGeneratorTest(generatedId)
									)
								)
							)
						)
					)
				)
			);

			expect(error).toEqual(new OrganizationAccessDenied(targetId));
			expect(repo[operation]).not.toHaveBeenCalled();
		}
	);

	it.each(["get", "update", "delete"] as const)(
		"maps permitted %s absence to OrganizationNotFound",
		async operation => {
			const repo = repository({
				[operation]: vi.fn(() => Effect.succeed(Option.none())),
			});

			const error = await runService(repo, service => {
				if (operation === "get") {
					return Effect.flip(service.get({ actorId, access: "platform", targetId }));
				}
				if (operation === "update") {
					return Effect.flip(
						service.update({
							actorId,
							access: "platform",
							targetId,
							input: preserveDescription,
						})
					);
				}
				return Effect.flip(service.delete({ actorId, access: "platform", targetId }));
			});

			expect(error).toEqual(new OrganizationNotFound(targetId));
		}
	);

	it("creates only with platform access and uses the injected ID generator", async () => {
		const repo = repository();

		const created = await runService(repo, service =>
			service.create({
				actorId,
				access: "platform",
				input: { name: "Created", description: "Description" },
			})
		);

		expect(repo.create).toHaveBeenCalledWith({
			id: generatedId,
			name: "Created",
			description: "Description",
		});
		expect(created.id).toBe(generatedId);
	});

	it("rejects create for current access without invoking persistence", async () => {
		const repo = repository();

		const error = await runService(repo, service =>
			Effect.flip(service.create({ actorId, access: "current", input: { name: "Denied" } }))
		);

		expect(error).toEqual(new OrganizationAccessDenied());
		expect(repo.create).not.toHaveBeenCalled();
	});

	it("returns updated and deleted Organizations from permitted operations", async () => {
		const repo = repository();

		const result = await runService(repo, service =>
			Effect.all([
				service.update({
					actorId,
					access: "platform",
					targetId,
					input: preserveDescription,
				}),
				service.delete({ actorId, access: "platform", targetId }),
			])
		);

		expect(result).toEqual([organization, organization]);
	});

	it.each(["list", "get", "create", "update", "delete"] as const)(
		"propagates infrastructure failures from %s without remapping them",
		async operation => {
			for (const failure of infrastructureFailures) {
				const repo = repository({
					[operation]: vi.fn(() => Effect.fail(failure)),
				});

				const error = await runService(repo, service => {
					if (operation === "list") {
						return Effect.flip(service.list({ actorId, access: "platform", offset: 0, limit: 20 })).pipe(
							Effect.orDie
						);
					}
					if (operation === "get") {
						return Effect.flip(service.get({ actorId, access: "platform", targetId })).pipe(Effect.orDie);
					}
					if (operation === "create") {
						return Effect.flip(
							service.create({ actorId, access: "platform", input: { name: "Created" } })
						).pipe(Effect.orDie);
					}
					if (operation === "update") {
						return Effect.flip(
							service.update({
								actorId,
								access: "platform",
								targetId,
								input: preserveDescription,
							})
						).pipe(Effect.orDie);
					}
					return Effect.flip(service.delete({ actorId, access: "platform", targetId })).pipe(
						Effect.orDie
					);
				});

				expect(error).toBe(failure);
			}
		}
	);

	it("propagates dependent failures only from delete", async () => {
		const failure = new OrganizationHasDependents(targetId);
		const repo = repository({ delete: vi.fn(() => Effect.fail(failure)) });

		const error = await runService(repo, service =>
			Effect.flip(service.delete({ actorId, access: "platform", targetId }))
		);

		expect(error).toBe(failure);
	});

	it("exposes operation-specific service error types", () => {
		type EffectError<T> = T extends Effect.Effect<unknown, infer E, unknown> ? E : never;
		type Service = OrganizationService["Service"];
		type Repository = OrganizationRepositoryShape;

		expectTypeOf<EffectError<ReturnType<Service["list"]>>>().toEqualTypeOf<OrganizationListError>();
		expectTypeOf<EffectError<ReturnType<Service["get"]>>>().toEqualTypeOf<OrganizationGetError>();
		expectTypeOf<
			EffectError<ReturnType<Service["create"]>>
		>().toEqualTypeOf<OrganizationCreateError>();
		expectTypeOf<
			EffectError<ReturnType<Service["update"]>>
		>().toEqualTypeOf<OrganizationUpdateError>();
		expectTypeOf<
			EffectError<ReturnType<Service["delete"]>>
		>().toEqualTypeOf<OrganizationDeleteError>();
		expectTypeOf<Extract<OrganizationListError, OrganizationNotFound>>().toEqualTypeOf<never>();
		expectTypeOf<Extract<OrganizationCreateError, OrganizationNotFound>>().toEqualTypeOf<never>();
		expectTypeOf<
			Extract<EffectError<ReturnType<Repository["list"]>>, OrganizationHasDependents>
		>().toEqualTypeOf<never>();
		expectTypeOf<
			Extract<EffectError<ReturnType<Repository["delete"]>>, OrganizationHasDependents>
		>().toEqualTypeOf<OrganizationHasDependents>();
		expectTypeOf<
			Extract<OrganizationDeleteError, OrganizationHasDependents>
		>().toEqualTypeOf<OrganizationHasDependents>();
		expectTypeOf<OrganizationPersistenceFailure>().toMatchTypeOf<OrganizationInfrastructureError>();
	});
});
