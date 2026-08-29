import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { HttpError, InternalServerError } from "@/lib/errors";
import type { LedgerAccountBalanceMonitorID, LedgerAccountID } from "@/repo/entities/types";

import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import {
	type LedgerAccountBalanceMonitorInfrastructureError,
	LedgerAccountBalanceMonitorNotFound,
	LedgerAccountBalanceMonitorPersistenceFailure,
} from "./LedgerAccountBalanceMonitorErrors";
import {
	type LedgerAccountBalanceMonitorRepo,
	LedgerAccountBalanceMonitorRepoTag,
} from "./LedgerAccountBalanceMonitorRepo";
import type { LedgerAccountBalanceMonitorRequest } from "./LedgerAccountBalanceMonitorSchema";
import {
	type LedgerAccountBalanceMonitorCreateError,
	type LedgerAccountBalanceMonitorDeleteError,
	type LedgerAccountBalanceMonitorGetError,
	type LedgerAccountBalanceMonitorListError,
	LedgerAccountBalanceMonitorService,
	LedgerAccountBalanceMonitorServiceTag,
	type LedgerAccountBalanceMonitorUpdateError,
	ledgerAccountBalanceMonitorServiceLayer,
} from "./LedgerAccountBalanceMonitorService";

const monitorId = TypeID.fromString<"lbm">(
	"lbm_01h2x3y4z5a6b7c8d9e0f1g2h3"
) as LedgerAccountBalanceMonitorID;
const accountId = TypeID.fromString<"lat">("lat_01h2x3y4z5a6b7c8d9e0f1g2h4") as LedgerAccountID;
const now = DateTime.fromISO("2026-08-29T15:45:00.000Z", { zone: "utc" });
const request: LedgerAccountBalanceMonitorRequest = {
	accountId: accountId.toString(),
	description: "Low balance",
	alertCondition: [{ field: "balance", operator: "<", value: 1000 }],
	metadata: { team: "treasury" },
};
const existing = LedgerAccountBalanceMonitor.fromRequest(monitorId, accountId, request, now);

const repository = (
	overrides: Partial<LedgerAccountBalanceMonitorRepo> = {}
): LedgerAccountBalanceMonitorRepo =>
	vi.mocked<LedgerAccountBalanceMonitorRepo>({
		listMonitors: vi.fn(() => Effect.succeed([existing])),
		// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives the stub value.
		getMonitor: vi.fn(() => Effect.succeed(Option.some(existing))),
		createMonitor: vi.fn(record => Effect.succeed(record)),
		// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives the stub value.
		updateMonitor: vi.fn((_id, record) => Effect.succeed(Option.some(record))),
		// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives the presence marker.
		deleteMonitor: vi.fn(() => Effect.succeed(Option.some(undefined))),
		...overrides,
	});

const runService = <A, E>(
	repositoryImplementation: LedgerAccountBalanceMonitorRepo,
	use: (service: LedgerAccountBalanceMonitorService) => Effect.Effect<A, E>
) => {
	const serviceLayer = ledgerAccountBalanceMonitorServiceLayer.pipe(
		Layer.provide(Layer.succeed(LedgerAccountBalanceMonitorRepoTag, repositoryImplementation))
	);
	return Effect.runPromise(
		Effect.gen(function* () {
			yield* TestClock.setTime(now.toMillis());
			return yield* use(yield* LedgerAccountBalanceMonitorServiceTag);
		}).pipe(Effect.provide(Layer.merge(serviceLayer, TestClock.layer())))
	);
};

type Operation = "list" | "get" | "create" | "update" | "delete";

const invoke = (
	service: LedgerAccountBalanceMonitorService,
	operation: Operation
): Effect.Effect<unknown, HttpError> => {
	switch (operation) {
		case "list":
			return service.listLedgerAccountBalanceMonitors(10, 5);
		case "get":
			return service.getLedgerAccountBalanceMonitor(monitorId.toString());
		case "create":
			return service.createLedgerAccountBalanceMonitor(request);
		case "update":
			return service.updateLedgerAccountBalanceMonitor(monitorId.toString(), request);
		case "delete":
			return service.deleteLedgerAccountBalanceMonitor(monitorId.toString());
	}
};

describe("LedgerAccountBalanceMonitorService", () => {
	it("forwards list pagination", async () => {
		const repo = repository();

		await expect(
			runService(repo, service => service.listLedgerAccountBalanceMonitors(10, 5))
		).resolves.toEqual([existing]);
		expect(repo.listMonitors).toHaveBeenCalledWith({ offset: 10, limit: 5 });
	});

	it("parses the Balance Monitor ID for get and delegates", async () => {
		const repo = repository();

		await expect(
			runService(repo, service => service.getLedgerAccountBalanceMonitor(monitorId.toString()))
		).resolves.toBe(existing);
		expect(repo.getMonitor).toHaveBeenCalledWith(monitorId);
	});

	it("generates an lbm ID, parses the Account ID, and uses application time on create", async () => {
		const repo = repository();

		const created = await runService(repo, service =>
			service.createLedgerAccountBalanceMonitor(request)
		);

		expect(created.id.getType()).toBe("lbm");
		expect(created.accountId).toEqual(accountId);
		expect(created.created).toEqual(now);
		expect(created.updated).toEqual(now);
		expect(repo.createMonitor).toHaveBeenCalledWith(created);
	});

	it("parses both IDs and uses application time on update", async () => {
		const repo = repository();

		const updated = await runService(repo, service =>
			service.updateLedgerAccountBalanceMonitor(monitorId.toString(), request)
		);

		expect(updated).toMatchObject({ id: monitorId, accountId, created: now, updated: now });
		expect(repo.updateMonitor).toHaveBeenCalledWith(monitorId, updated);
	});

	it("parses the Balance Monitor ID for delete and delegates", async () => {
		const repo = repository();

		await expect(
			runService(repo, service => service.deleteLedgerAccountBalanceMonitor(monitorId.toString()))
		).resolves.toBeUndefined();
		expect(repo.deleteMonitor).toHaveBeenCalledWith(monitorId);
	});

	it.each(["get", "update", "delete"] as const)(
		"maps missing %s results to LedgerAccountBalanceMonitorNotFound",
		async operation => {
			const repo = repository(
				operation === "get"
					? { getMonitor: vi.fn(() => Effect.succeed(Option.none())) }
					: operation === "update"
						? { updateMonitor: vi.fn(() => Effect.succeed(Option.none())) }
						: { deleteMonitor: vi.fn(() => Effect.succeed(Option.none())) }
			);

			const error = await runService(repo, service => Effect.flip(invoke(service, operation)));

			expect(error).toBeInstanceOf(LedgerAccountBalanceMonitorNotFound);
			expect(error.message).toBe(`Balance monitor not found: ${monitorId.toString()}`);
		}
	);

	it.each(["list", "get", "create", "update", "delete"] as const)(
		"preserves repository failures from %s",
		async operation => {
			const failure = new LedgerAccountBalanceMonitorPersistenceFailure(new Error("database"));
			const failed = vi.fn(() => Effect.fail(failure));
			const repo = repository({
				...(operation === "list" ? { listMonitors: failed } : {}),
				...(operation === "get" ? { getMonitor: failed } : {}),
				...(operation === "create" ? { createMonitor: failed } : {}),
				...(operation === "update" ? { updateMonitor: failed } : {}),
				...(operation === "delete" ? { deleteMonitor: failed } : {}),
			} as Partial<LedgerAccountBalanceMonitorRepo>);

			const error = await runService(repo, service => Effect.flip(invoke(service, operation)));

			expect(error).toBe(failure);
		}
	);

	it.each([
		["malformed", "create", "not-an-account"],
		["malformed", "update", "not-an-account"],
		["canonical wrong-prefix", "create", "lgr_01h2x3y4z5a6b7c8d9e0f1g2h4"],
		["canonical wrong-prefix", "update", "lgr_01h2x3y4z5a6b7c8d9e0f1g2h4"],
	] as const)(
		"keeps %s body Account IDs on the sanitized internal path for %s",
		async (_case, operation, invalidAccountId) => {
			const repo = repository();
			const invalid = { ...request, accountId: invalidAccountId };

			const error = await runService(repo, service =>
				Effect.flip(
					operation === "create"
						? service.createLedgerAccountBalanceMonitor(invalid)
						: service.updateLedgerAccountBalanceMonitor(monitorId.toString(), invalid)
				)
			);

			expect(error).toBeInstanceOf(InternalServerError);
			expect(error.message).toBe("Internal Server Error");
			expect(repo.createMonitor).not.toHaveBeenCalled();
			expect(repo.updateMonitor).not.toHaveBeenCalled();
		}
	);

	it("exposes only HttpErrors from service error channels", () => {
		expectTypeOf<LedgerAccountBalanceMonitorInfrastructureError>().toMatchTypeOf<HttpError>();
		expectTypeOf<LedgerAccountBalanceMonitorListError>().toMatchTypeOf<HttpError>();
		expectTypeOf<LedgerAccountBalanceMonitorGetError>().toMatchTypeOf<HttpError>();
		expectTypeOf<LedgerAccountBalanceMonitorCreateError>().toMatchTypeOf<HttpError>();
		expectTypeOf<LedgerAccountBalanceMonitorUpdateError>().toMatchTypeOf<HttpError>();
		expectTypeOf<LedgerAccountBalanceMonitorDeleteError>().toMatchTypeOf<HttpError>();
	});
});
