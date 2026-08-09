import { Effect, Layer, Option } from "effect";
import { TypeID } from "typeid-js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { HttpError, InternalServerError, ServiceUnavailableError } from "@/lib/errors";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import { Ledger, type LedgerWrite } from "./domain/Ledger";
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

const organizationId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
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
const deleted = Option.void;

const repository = (overrides: Partial<LedgerRepo> = {}): LedgerRepo =>
	vi.mocked<LedgerRepo>({
		list: vi.fn(() => Effect.succeed([ledger])),
		get: vi.fn(() => Effect.succeed(someLedger)),
		create: vi.fn((record: LedgerWrite) =>
			Effect.succeed(
				new Ledger({
					...record,
					created: ledger.created,
					updated: ledger.updated,
				})
			)
		),
		update: vi.fn(() => Effect.succeed(someLedger)),
		delete: vi.fn(() => Effect.succeed(deleted)),
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

		expect(repo.list).toHaveBeenCalledWith(organizationId, { offset: 10, limit: 5 });
		expect(repo.get).toHaveBeenCalledWith(organizationId, ledgerId);
	});

	it("generates a canonical Ledger ID lazily and calls only create", async () => {
		const repo = repository();

		expect(repo.create).not.toHaveBeenCalled();
		const created = await runService(repo, service =>
			service.createLedger(organizationId, {
				name: "Created",
				description: "Description",
				metadata: { externalId: "book-99" },
			})
		);

		expect(created.id.toString()).toMatch(/^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
		expect(repo.create).toHaveBeenCalledWith({
			id: created.id,
			organizationId,
			name: "Created",
			description: "Description",
			metadata: { externalId: "book-99" },
		});
		expect(repo.update).not.toHaveBeenCalled();
	});

	it("uses only update and forwards replacement fields", async () => {
		const repo = repository();

		await runService(repo, service =>
			service.updateLedger(organizationId, ledgerId, { name: "Replaced" })
		);

		expect(repo.update).toHaveBeenCalledWith({
			id: ledgerId,
			organizationId,
			name: "Replaced",
		});
		expect(repo.create).not.toHaveBeenCalled();
	});

	it.each(["get", "update", "delete"] as const)(
		"maps an absent %s result to LedgerNotFound",
		async operation => {
			const repo = repository({
				...(operation === "get" ? { get: vi.fn(() => Effect.succeed(Option.none())) } : {}),
				...(operation === "update" ? { update: vi.fn(() => Effect.succeed(Option.none())) } : {}),
				...(operation === "delete" ? { delete: vi.fn(() => Effect.succeed(Option.none())) } : {}),
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
		const repo = repository({ create: vi.fn(() => Effect.fail(failure)) });

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
				...(operation === "list" ? { list: vi.fn(() => Effect.fail(failure)) } : {}),
				...(operation === "get" ? { get: vi.fn(() => Effect.fail(failure)) } : {}),
				...(operation === "update" ? { update: vi.fn(() => Effect.fail(failure)) } : {}),
				...(operation === "delete" ? { delete: vi.fn(() => Effect.fail(failure)) } : {}),
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
			repository({ list: vi.fn(() => Effect.fail(persistence)) }),
			service => Effect.flip(service.listLedgers(organizationId, { offset: 0, limit: 20 }))
		);
		const deleteError = await runService(
			repository({ delete: vi.fn(() => Effect.fail(dependency)) }),
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
