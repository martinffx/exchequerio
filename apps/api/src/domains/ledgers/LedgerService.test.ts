import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { HttpError, InternalServerError, ServiceUnavailableError } from "@/lib/errors";
import { newLedgerID, newOrgID } from "@/repo/entities/types";
import { Ledger } from "./Ledger";
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
	created: DateTime.fromISO("2026-08-09T10:00:00.000Z", { zone: "utc" }),
	updated: DateTime.fromISO("2026-08-09T10:00:00.000Z", { zone: "utc" }),
});
const someLedger = Option.fromNullishOr(ledger);

const repo = vi.mocked<LedgerRepo>({
	listLedgers: vi.fn(() => Effect.succeed([ledger])),
	getLedger: vi.fn(() => Effect.succeed(someLedger)),
	createLedger: vi.fn((record: Ledger) => Effect.succeed(record)),
	updateLedger: vi.fn(() => Effect.succeed(someLedger)),
	deleteLedger: vi.fn(() => Effect.succeed(someLedger)),
	deleteLedgerFixtures: vi.fn(() => Effect.void),
});
const runtime = ManagedRuntime.make(
	ledgerServiceLayer.pipe(Layer.provide(Layer.succeed(LedgerRepoTag, repo)))
);
let service: LedgerService;
beforeAll(async () => {
	service = await runtime.runPromise(LedgerServiceTag);
});
beforeEach(() => {
	vi.resetAllMocks();
});
afterAll(() => runtime.dispose());

const repositoryMethods = {
	list: "listLedgers",
	get: "getLedger",
	update: "updateLedger",
	delete: "deleteLedger",
} as const;
type Operation = keyof typeof repositoryMethods;

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
		await runtime.runPromise(
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
		repo.createLedger.mockImplementation(record => Effect.succeed(record));
		repo.updateLedger.mockImplementation(record => Effect.succeed(Option.fromNullishOr(record)));

		const result = await runtime.runPromise(
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
		expect(DateTime.isDateTime(result.created)).toBe(true);
		expect(DateTime.isDateTime(result.updated)).toBe(true);
		if (testCase.operation === "update") expect(result.id).toBe(ledgerId);
		const called = testCase.operation === "create" ? repo.createLedger : repo.updateLedger;
		expect(called).toHaveBeenCalledWith(result);
		expect(vi.mocked(called).mock.calls[0]?.[0]).toBeInstanceOf(Ledger);
	});

	it.each(["get", "update", "delete"] as const)(
		"maps an absent %s result to LedgerNotFound",
		async operation => {
			repo[repositoryMethods[operation]].mockReturnValue(Effect.succeed(Option.none()));
			const error = await runtime.runPromise(
				Effect.flip(
					operation === "get"
						? service.getLedger(organizationId, ledgerId)
						: operation === "update"
							? service.updateLedger(organizationId, ledgerId, { name: "Missing" })
							: service.deleteLedger(organizationId, ledgerId)
				)
			);

			expect(error).toEqual(new LedgerNotFound());
		}
	);

	it("marks create-time repository unavailability as non-retryable", async () => {
		const failure = new LedgerRepositoryUnavailable(new Error("unavailable"));
		repo.createLedger.mockImplementation(() => Effect.fail(failure));

		const error = await runtime.runPromise(
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
			repo[repositoryMethods[operation]].mockReturnValue(Effect.fail(failure));
			const error = await runtime.runPromise(Effect.flip(invoke(service, operation)));

			expect(error).toBe(failure);
			expect(error.retryable).toBe(true);
		}
	);

	it("preserves persistence and dependency failures", async () => {
		const persistence = new LedgerPersistenceFailure(new Error("query failed"));
		const dependency = new LedgerHasDependents();

		repo.listLedgers.mockImplementation(() => Effect.fail(persistence));
		const listError = await runtime.runPromise(
			Effect.flip(service.listLedgers(organizationId, { offset: 0, limit: 20 }))
		);
		repo.deleteLedger.mockImplementation(() => Effect.fail(dependency));
		const deleteError = await runtime.runPromise(
			Effect.flip(service.deleteLedger(organizationId, ledgerId))
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
