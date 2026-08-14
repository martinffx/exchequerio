import { Effect, Layer, Option } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { HttpError, InternalServerError, ServiceUnavailableError } from "@/lib/errors";
import { newLedgerID, newOrgID } from "@/repo/entities/types";
import { Ledger } from "./domain/Ledger";
import {
	LedgerHasDependents,
	LedgerNotFound,
	LedgerPersistenceFailure,
	LedgerRepositoryUnavailable,
} from "./LedgerErrors";
import type { LedgerRepo } from "./LedgerRepo";
import { LedgerRepoTag } from "./LedgerRepo";
import {
	LedgerService,
	LedgerServiceTag,
	ledgerServiceLayer,
	type LedgerCreateError,
	type LedgerDeleteError,
	type LedgerGetError,
	type LedgerListError,
	type LedgerUpdateError,
} from "./LedgerService";

const organizationId = newOrgID();
const ledgerId = newLedgerID();
const ledger = new Ledger({
	id: ledgerId,
	organizationId,
	name: "Operating Ledger",
	description: "Primary book",
	metadata: { externalId: "book-42" },
	created: new Date("2026-08-09T10:00:00.000Z"),
	updated: new Date("2026-08-09T10:00:00.000Z"),
});
const someLedger = Option.fromNullishOr(ledger);

const repository = (overrides: Partial<LedgerRepo> = {}): LedgerRepo =>
	vi.mocked<LedgerRepo>({
		listLedgers: vi.fn(() => Effect.succeed([ledger])),
		getLedger: vi.fn(() => Effect.succeed(someLedger)),
		createLedger: vi.fn((record: Ledger) => Effect.succeed(record)),
		updateLedger: vi.fn(() => Effect.succeed(someLedger)),
		deleteLedger: vi.fn(() => Effect.succeed(someLedger)),
		...overrides,
	});

const runService = <A, E>(
	repositoryImplementation: LedgerRepo,
	use: (service: LedgerService) => Effect.Effect<A, E>
) =>
	Effect.runPromise(
		LedgerServiceTag.pipe(Effect.flatMap(use)).pipe(
			Effect.provide(
				ledgerServiceLayer.pipe(Layer.provide(Layer.succeed(LedgerRepoTag, repositoryImplementation)))
			)
		)
	);

type Operation = "list" | "get" | "update" | "delete";

const invoke = (
	service: LedgerService,
	operation: Operation
): Effect.Effect<unknown, HttpError> => {
	switch (operation) {
		case "list":
			return service.listLedgers(organizationId, { offset: 0, limit: 20 });
		case "get":
			return service.getLedger(organizationId, ledgerId);
		case "update":
			return service.updateLedger(organizationId, ledgerId, { name: "Updated" });
		case "delete":
			return service.deleteLedger(organizationId, ledgerId);
	}
};

describe("LedgerService", () => {
	it("forwards tenant-scoped list and get inputs", async () => {
		const repo = repository();

		await runService(repo, service =>
			Effect.all([
				service.listLedgers(organizationId, { offset: 10, limit: 5 }),
				service.getLedger(organizationId, ledgerId),
			])
		);

		expect(repo.listLedgers).toHaveBeenCalledWith(organizationId, { offset: 10, limit: 5 });
		expect(repo.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
	});

	it.each([
		{
			operation: "create" as const,
			request: {
				name: "Created",
				description: "Description",
				metadata: { externalId: "book-99" },
			},
		},
		{
			operation: "update" as const,
			request: { name: "Replaced" },
		},
	])("maps $operation requests to Ledger domain values", async testCase => {
		const repo = repository({
			createLedger: vi.fn(record => Effect.succeed(record)),
			updateLedger: vi.fn(record => Effect.succeed(Option.fromNullishOr(record))),
		});

		const result = await runService(repo, service =>
			testCase.operation === "create"
				? service.createLedger(organizationId, testCase.request)
				: service.updateLedger(organizationId, ledgerId, testCase.request)
		);

		expect(result).toMatchObject({
			organizationId,
			name: testCase.request.name,
			description: testCase.request.description,
			metadata: testCase.request.metadata,
		});
		expect(result.id.toString()).toMatch(/^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
		if (testCase.operation === "update") expect(result.id).toBe(ledgerId);
		const called = testCase.operation === "create" ? repo.createLedger : repo.updateLedger;
		expect(called).toHaveBeenCalledWith(result);
		expect(vi.mocked(called).mock.calls[0]?.[0]).toBeInstanceOf(Ledger);
	});

	it.each(["get", "update", "delete"] as const)(
		"maps an absent %s result to LedgerNotFound",
		async operation => {
			const repo = repository({
				...(operation === "get" ? { getLedger: vi.fn(() => Effect.succeed(Option.none())) } : {}),
				...(operation === "update" ? { updateLedger: vi.fn(() => Effect.succeed(Option.none())) } : {}),
				...(operation === "delete" ? { deleteLedger: vi.fn(() => Effect.succeed(Option.none())) } : {}),
			});
			const error = await runService(repo, service =>
				Effect.flip(
					operation === "get"
						? service.getLedger(organizationId, ledgerId)
						: operation === "update"
							? service.updateLedger(organizationId, ledgerId, { name: "Missing" })
							: service.deleteLedger(organizationId, ledgerId)
				)
			);

			expect(error).toEqual(new LedgerNotFound(organizationId.toString(), ledgerId.toString()));
		}
	);

	it("marks create-time repository unavailability as non-retryable", async () => {
		const failure = new LedgerRepositoryUnavailable(new Error("unavailable"));
		const repo = repository({ createLedger: vi.fn(() => Effect.fail(failure)) });

		const error = await runService(repo, service =>
			Effect.flip(service.createLedger(organizationId, { name: "Created" }))
		);

		expect(error).toBeInstanceOf(ServiceUnavailableError);
		expect(error).not.toBe(failure);
		expect(error.retryable).toBe(false);
	});

	it.each(["list", "get", "update", "delete"] as const)(
		"preserves retryable repository unavailability from %s",
		async operation => {
			const failure = new LedgerRepositoryUnavailable(new Error("unavailable"));
			const repo = repository({
				...(operation === "list" ? { listLedgers: vi.fn(() => Effect.fail(failure)) } : {}),
				...(operation === "get" ? { getLedger: vi.fn(() => Effect.fail(failure)) } : {}),
				...(operation === "update" ? { updateLedger: vi.fn(() => Effect.fail(failure)) } : {}),
				...(operation === "delete" ? { deleteLedger: vi.fn(() => Effect.fail(failure)) } : {}),
			});
			const error = await runService(repo, service => Effect.flip(invoke(service, operation)));

			expect(error).toBe(failure);
			expect(error.retryable).toBe(true);
		}
	);

	it("preserves persistence and dependency failures", async () => {
		const persistence = new LedgerPersistenceFailure(new Error("query failed"));
		const dependency = new LedgerHasDependents(organizationId.toString(), ledgerId.toString());

		const listError = await runService(
			repository({ listLedgers: vi.fn(() => Effect.fail(persistence)) }),
			service => Effect.flip(service.listLedgers(organizationId, { offset: 0, limit: 20 }))
		);
		const deleteError = await runService(
			repository({ deleteLedger: vi.fn(() => Effect.fail(dependency)) }),
			service => Effect.flip(service.deleteLedger(organizationId, ledgerId))
		);

		expect(listError).toBe(persistence);
		expect(listError).toBeInstanceOf(InternalServerError);
		expect(deleteError).toBe(dependency);
	});

	it("exposes only HttpErrors from service error channels", () => {
		expectTypeOf<LedgerListError>().toMatchTypeOf<HttpError>();
		expectTypeOf<LedgerGetError>().toMatchTypeOf<HttpError>();
		expectTypeOf<LedgerCreateError>().toMatchTypeOf<HttpError>();
		expectTypeOf<LedgerUpdateError>().toMatchTypeOf<HttpError>();
		expectTypeOf<LedgerDeleteError>().toMatchTypeOf<HttpError>();
	});
});
