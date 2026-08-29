import { Effect, Layer } from "effect";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/errors";
import type { LedgerAccountID, LedgerAccountStatementID, LedgerID } from "@/repo/entities/types";

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

const run = <A, E>(
	repository: LedgerAccountStatementRepo,
	use: (service: LedgerAccountStatementService) => Effect.Effect<A, E>
) =>
	Effect.runPromise(
		LedgerAccountStatementServiceTag.pipe(Effect.flatMap(use)).pipe(
			Effect.provide(
				ledgerAccountStatementServiceLayer.pipe(
					Layer.provide(Layer.succeed(LedgerAccountStatementRepoTag, repository))
				)
			)
		)
	);

describe("LedgerAccountStatementService", () => {
	it("parses the Statement ID and delegates get exactly once", async () => {
		const getStatement = vi.fn(() => Effect.succeed(stored));
		const repository: LedgerAccountStatementRepo = {
			getStatement,
			createStatement: vi.fn(() => Effect.succeed(stored)),
		};

		const result = await run(repository, service =>
			service.getLedgerAccountStatement(statementId.toString())
		);

		expect(result).toBe(stored);
		expect(getStatement).toHaveBeenCalledOnce();
		expect(getStatement).toHaveBeenCalledWith(statementId);
	});

	it("builds the placeholder Statement from body identifiers and start time", async () => {
		let received: LedgerAccountStatement | undefined;
		const repository: LedgerAccountStatementRepo = {
			getStatement: vi.fn(() => Effect.succeed(stored)),
			createStatement: vi.fn((statement: LedgerAccountStatement) => {
				received = statement;
				return Effect.succeed(statement);
			}),
		};
		const bodyLedgerId = new TypeID("lgr");
		const bodyAccountId = new TypeID("lat");
		const startDatetime = "2025-02-01T00:00:00.000Z";

		const result = await run(repository, service =>
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
			const repository: LedgerAccountStatementRepo = {
				getStatement: vi.fn(() => Effect.fail(error)),
				createStatement: vi.fn(() => Effect.fail(error)),
			};

			expect(
				await run(repository, service =>
					Effect.flip(service.getLedgerAccountStatement(statementId.toString()))
				)
			).toBe(error);
			expect(
				await run(repository, service =>
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
