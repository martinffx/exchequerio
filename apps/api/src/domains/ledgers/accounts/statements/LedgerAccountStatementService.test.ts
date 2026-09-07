import { Effect, Layer, ManagedRuntime } from "effect";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/errors";
import type { LedgerAccountID, LedgerAccountStatementID, LedgerID } from "@/lib/ids";

import { LedgerAccountStatement } from "./LedgerAccountStatement";
import {
	type LedgerAccountStatementRepo,
	LedgerAccountStatementRepoTag,
} from "./LedgerAccountStatementRepo";
import {
	type LedgerAccountStatementService,
	LedgerAccountStatementServiceTag,
	ledgerAccountStatementServiceLayer,
} from "./LedgerAccountStatementService";

const statementId = new TypeID("lst") as LedgerAccountStatementID;
const ledgerId = new TypeID("lgr") as LedgerID;
const accountId = new TypeID("lat") as LedgerAccountID;
const stored = new LedgerAccountStatement({
	id: statementId,
	ledgerId,
	accountId,
	statementDate: new Date("2025-01-01T00:00:00.000Z"),
	openingBalance: 0,
	closingBalance: 0,
	totalCredits: 0,
	totalDebits: 0,
	transactionCount: 0,
	created: new Date("2025-01-01T00:00:00.000Z"),
	updated: new Date("2025-01-01T00:00:00.000Z"),
});

const repository = vi.mocked<LedgerAccountStatementRepo>({
	getStatement: vi.fn(() => Effect.succeed(stored)),
	createStatement: vi.fn(statement => Effect.succeed(statement)),
});
const runtime = ManagedRuntime.make(
	ledgerAccountStatementServiceLayer.pipe(
		Layer.provide(Layer.succeed(LedgerAccountStatementRepoTag, repository))
	)
);
let service: LedgerAccountStatementService;
beforeAll(async () => {
	service = await runtime.runPromise(LedgerAccountStatementServiceTag);
});
beforeEach(() => {
	vi.resetAllMocks();
});
afterAll(() => runtime.dispose());

describe("LedgerAccountStatementService", () => {
	it("parses the Statement ID and delegates get exactly once", async () => {
		const result = await runtime.runPromise(
			service.getLedgerAccountStatement(statementId.toString())
		);

		expect(result).toBe(stored);
		expect(repository.getStatement).toHaveBeenCalledOnce();
		expect(repository.getStatement).toHaveBeenCalledWith(statementId);
	});

	it("builds the placeholder Statement from body identifiers and start time", async () => {
		let received: LedgerAccountStatement | undefined;
		repository.createStatement.mockImplementation(statement => {
			received = statement;
			return Effect.succeed(statement);
		});
		const bodyLedgerId = new TypeID("lgr");
		const bodyAccountId = new TypeID("lat");
		const startDatetime = "2025-02-01T00:00:00.000Z";

		const result = await runtime.runPromise(
			service.createLedgerAccountStatement({
				ledgerId: bodyLedgerId.toString(),
				accountId: bodyAccountId.toString(),
				description: "ignored",
				startDatetime,
				endDatetime: "2025-03-01T00:00:00.000Z",
			})
		);

		expect(result).toBe(received);
		expect(received).toMatchObject({
			ledgerId: bodyLedgerId,
			accountId: bodyAccountId,
			statementDate: new Date(startDatetime),
			openingBalance: 0,
			closingBalance: 0,
			totalCredits: 0,
			totalDebits: 0,
			transactionCount: 0,
			metadata: undefined,
		});
	});

	it.each([new NotFoundError("Statement not found"), new Error("unexpected repository failure")])(
		"preserves the repository failure %#",
		async error => {
			repository.getStatement.mockReturnValue(Effect.fail(error));
			repository.createStatement.mockReturnValue(Effect.fail(error));

			expect(
				await runtime.runPromise(Effect.flip(service.getLedgerAccountStatement(statementId.toString())))
			).toBe(error);
			expect(
				await runtime.runPromise(
					Effect.flip(
						service.createLedgerAccountStatement({
							ledgerId: ledgerId.toString(),
							accountId: accountId.toString(),
							startDatetime: "2025-01-01T00:00:00.000Z",
							endDatetime: "2025-02-01T00:00:00.000Z",
						})
					)
				)
			).toBe(error);
		}
	);
});
