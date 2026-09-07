import { Effect, Option } from "effect";
import { TypeID } from "typeid-js";
import { encodeUuid } from "@/lib/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError, NotFoundError, ServiceUnavailableError } from "@/lib/errors";
import type { OrgID, LedgerID, LedgerAccountID, LedgerAccountStatementID } from "@/lib/ids";
import type { IdempotencyService } from "@/lib/IdempotencyService";
import { calculateStatementBalances, LedgerAccountStatement } from "./LedgerAccountStatement";
import type { LedgerAccountStatementRepo } from "./LedgerAccountStatementRepo";
import { LedgerAccountStatementService } from "./LedgerAccountStatementService";

const orgId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const accountId = new TypeID("lat") as LedgerAccountID;
const statementId = new TypeID("lst") as LedgerAccountStatementID;
const assetId = new TypeID("ast");
const request = {
	startDatetime: "2026-01-01T00:00:00.000Z",
	endDatetime: "2026-02-01T00:00:00.000Z",
};
const balances = calculateStatementBalances("debit", {
	postedCredits: 0n,
	postedDebits: 0n,
	unpostedCredits: 0n,
	unpostedDebits: 0n,
});
const stored = LedgerAccountStatement.fromRow({
	id: encodeUuid(statementId),
	organizationId: encodeUuid(orgId),
	ledgerId: encodeUuid(ledgerId),
	accountId: encodeUuid(accountId),
	startDatetime: new Date(request.startDatetime),
	endDatetime: new Date(request.endDatetime),
	ledgerAccountVersion: 3,
	snapshot: {
		normalBalance: "debit",
		assetId: encodeUuid(assetId),
		assetCode: "EUR",
		minorUnitExponent: 2,
		startingBalances: balances,
		endingBalances: balances,
	},
	description: "January",
	metadata: {},
	lockVersion: 1,
	created: new Date(request.endDatetime),
	updated: new Date(request.endDatetime),
});
const repository = vi.mocked<LedgerAccountStatementRepo>({
	getStatement: vi.fn(() => Effect.succeed(stored)),
	createStatement: vi.fn(() => Effect.succeed(stored)),
	listStatements: vi.fn(() => Effect.succeed([stored])),
	getEntries: vi.fn(() => Effect.succeed([])),
	updateAnnotations: vi.fn(() => Effect.succeed(stored)),
});
const idempotency = vi.mocked<IdempotencyService>({
	claim: vi.fn(() => Effect.succeed(Option.none())),
	complete: vi.fn(() => Effect.void),
	release: vi.fn(() => Effect.void),
});
const service = new LedgerAccountStatementService(repository, idempotency);
beforeEach(() => vi.clearAllMocks());

describe("Statement orchestration", () => {
	it("claims a new action, generates an ID, creates once, and records its result", async () => {
		const result = await Effect.runPromise(
			service.createLedgerAccountStatement(orgId, ledgerId, accountId, "create-1", request)
		);
		expect(result).toBe(stored);
		expect(idempotency.claim).toHaveBeenCalledWith(orgId, "statements.create", "create-1");
		expect(repository.createStatement).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			accountId,
			expect.any(TypeID),
			request
		);
		expect(repository.createStatement.mock.calls[0]?.[3].getType()).toBe("lst");
		expect(idempotency.complete).toHaveBeenCalledWith(
			orgId,
			"statements.create",
			"create-1",
			stored.id
		);
	});
	it("replays the scoped saved resource without generating another snapshot", async () => {
		idempotency.claim.mockReturnValueOnce(Effect.succeed(Option.fromUndefinedOr(stored.id)));
		expect(
			await Effect.runPromise(
				service.createLedgerAccountStatement(orgId, ledgerId, accountId, "replay", request)
			)
		).toBe(stored);
		expect(repository.getStatement).toHaveBeenCalledWith(orgId, ledgerId, accountId, statementId);
		expect(repository.createStatement).not.toHaveBeenCalled();
		expect(idempotency.complete).not.toHaveBeenCalled();
	});
	it("validates the period before claiming", async () => {
		const error = await Effect.runPromise(
			Effect.flip(
				service.createLedgerAccountStatement(orgId, ledgerId, accountId, "invalid", {
					...request,
					endDatetime: request.startDatetime,
				})
			)
		);
		expect(error).toBeInstanceOf(BadRequestError);
		expect(idempotency.claim).not.toHaveBeenCalled();
		expect(repository.createStatement).not.toHaveBeenCalled();
	});
	it.each([new BadRequestError("too large"), new NotFoundError("missing account")])(
		"releases a known rejected creation",
		async error => {
			repository.createStatement.mockReturnValueOnce(Effect.fail(error));
			expect(
				await Effect.runPromise(
					Effect.flip(
						service.createLedgerAccountStatement(orgId, ledgerId, accountId, "rejected", request)
					)
				)
			).toBe(error);
			expect(idempotency.release).toHaveBeenCalledWith(orgId, "statements.create", "rejected");
			expect(idempotency.complete).not.toHaveBeenCalled();
		}
	);
	it("retains a claim when the persistence outcome is uncertain", async () => {
		const failure = new ServiceUnavailableError("connection lost");
		repository.createStatement.mockReturnValueOnce(Effect.fail(failure));
		expect(
			await Effect.runPromise(
				Effect.flip(
					service.createLedgerAccountStatement(orgId, ledgerId, accountId, "uncertain", request)
				)
			)
		).toBe(failure);
		expect(idempotency.release).not.toHaveBeenCalled();
	});
	it("retains the saved result when completing the claim fails", async () => {
		const failure = new ServiceUnavailableError("claim store unavailable");
		idempotency.complete.mockReturnValueOnce(Effect.fail(failure));
		expect(
			await Effect.runPromise(
				Effect.flip(
					service.createLedgerAccountStatement(orgId, ledgerId, accountId, "completed-db", request)
				)
			)
		).toBe(failure);
		expect(repository.createStatement).toHaveBeenCalledOnce();
		expect(idempotency.release).not.toHaveBeenCalled();
	});
	it("preserves scope and OCC input across read and annotation operations", async () => {
		const page = { offset: 2, limit: 3 };
		const update = { lockVersion: 4, metadata: { reviewed: "yes" } };
		await Effect.runPromise(
			service.getLedgerAccountStatement(orgId, ledgerId, accountId, statementId)
		);
		await Effect.runPromise(service.listLedgerAccountStatements(orgId, ledgerId, accountId, page));
		await Effect.runPromise(
			service.getLedgerAccountStatementEntries(orgId, ledgerId, accountId, statementId, page)
		);
		await Effect.runPromise(
			service.updateLedgerAccountStatement(orgId, ledgerId, accountId, statementId, update)
		);
		expect(repository.getStatement).toHaveBeenCalledWith(orgId, ledgerId, accountId, statementId);
		expect(repository.listStatements).toHaveBeenCalledWith(orgId, ledgerId, accountId, page);
		expect(repository.getEntries).toHaveBeenCalledWith(orgId, ledgerId, accountId, statementId, page);
		expect(repository.updateAnnotations).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			accountId,
			statementId,
			update
		);
	});
});
