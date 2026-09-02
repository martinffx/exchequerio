import { Context, Effect, Layer } from "effect";

import {
	type LedgerGetError,
	type LedgerService,
	LedgerServiceTag,
} from "@/domains/ledgers/LedgerService";
import {
	type AccountGetError,
	type AccountService,
	AccountServiceTag,
} from "@/domains/ledgers/accounts/AccountService";
import {
	type TransactionCreateError,
	type TransactionService,
	TransactionServiceTag,
} from "@/domains/ledgers/transactions/LedgerTransactionService";
import { ConflictError, type InvalidId } from "@/lib/errors";
import { parseId } from "@/lib/utils";
import type {
	LedgerAccountID,
	LedgerAccountSettlementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import {
	type IdempotencyPending,
	type IdempotencyService,
	IdempotencyServiceTag,
	type IdempotencyUnavailable,
} from "@/services/IdempotencyService";

import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import type { LedgerAccountSettlementLifecycleConflict } from "./LedgerAccountSettlementErrors";
import {
	type LedgerAccountSettlementCreateRepositoryError,
	type LedgerAccountSettlementDeleteRepositoryError,
	type LedgerAccountSettlementEntryRepositoryError,
	type LedgerAccountSettlementGetRepositoryError,
	type LedgerAccountSettlementListRepositoryError,
	type LedgerAccountSettlementReadRepositoryError,
	type LedgerAccountSettlementRepo,
	LedgerAccountSettlementRepoTag,
	type LedgerAccountSettlementStatusRepositoryError,
	type LedgerAccountSettlementUpdateRepositoryError,
} from "./LedgerAccountSettlementRepo";
import type {
	LedgerAccountSettlementRequest,
	SettlementStatus,
} from "./LedgerAccountSettlementSchema";

type LedgerAccountSettlementListError = LedgerAccountSettlementListRepositoryError | LedgerGetError;
type LedgerAccountSettlementGetError = LedgerAccountSettlementGetRepositoryError;
type LedgerAccountSettlementCreateError =
	| AccountGetError
	| ConflictError
	| IdempotencyPending
	| IdempotencyUnavailable
	| InvalidId
	| LedgerAccountSettlementCreateRepositoryError;
type LedgerAccountSettlementUpdateError =
	| AccountGetError
	| ConflictError
	| IdempotencyPending
	| IdempotencyUnavailable
	| InvalidId
	| LedgerAccountSettlementGetRepositoryError
	| LedgerAccountSettlementUpdateRepositoryError;
type LedgerAccountSettlementDeleteError =
	| IdempotencyPending
	| IdempotencyUnavailable
	| LedgerAccountSettlementDeleteRepositoryError;
type LedgerAccountSettlementEntryError =
	| IdempotencyPending
	| IdempotencyUnavailable
	| LedgerAccountSettlementEntryRepositoryError;
type LedgerAccountSettlementTransactionError =
	| ConflictError
	| LedgerAccountSettlementUpdateRepositoryError
	| TransactionCreateError;
type LedgerAccountSettlementTransitionError =
	| ConflictError
	| IdempotencyPending
	| IdempotencyUnavailable
	| InvalidId
	| LedgerAccountSettlementLifecycleConflict
	| LedgerAccountSettlementGetRepositoryError
	| LedgerAccountSettlementReadRepositoryError
	| LedgerAccountSettlementStatusRepositoryError
	| LedgerAccountSettlementTransactionError;

class LedgerAccountSettlementService {
	constructor(
		private readonly repository: LedgerAccountSettlementRepo,
		private readonly ledgerService: LedgerService,
		private readonly accountService: AccountService,
		private readonly transactionService: TransactionService,
		private readonly idempotency: IdempotencyService
	) {}

	listLedgerAccountSettlements(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Effect.Effect<LedgerAccountSettlementEntity[], LedgerAccountSettlementListError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(Effect.andThen(this.repository.listSettlements(organizationId, ledgerId, offset, limit)));
	}

	getLedgerAccountSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementGetError> {
		return this.repository.getSettlement(organizationId, settlementId);
	}

	createLedgerAccountSettlement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		request: LedgerAccountSettlementRequest
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementCreateError> {
		return this.idempotency.run({
			organizationId,
			action: "settlements.create",
			key: idempotencyKey,
			execute: this.getAccounts(organizationId, ledgerId, request).pipe(
				Effect.flatMap(([settledAccount, contraAccount]) =>
					LedgerAccountSettlementEntity.fromRequest(
						request,
						organizationId,
						settledAccount.currency,
						settledAccount.normalBalance,
						settledAccount.id,
						contraAccount.id
					)
				),
				Effect.flatMap(entity => this.repository.createSettlement(entity))
			),
			resultId: settlement => settlement.id.toString(),
			replay: resultId => this.getSettlementByStoredId(organizationId, resultId),
		});
	}

	updateLedgerAccountSettlement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		idempotencyKey: string,
		request: LedgerAccountSettlementRequest
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementUpdateError> {
		return this.idempotency.run({
			organizationId,
			action: "settlements.update",
			key: idempotencyKey,
			execute: this.getAccounts(organizationId, ledgerId, request).pipe(
				Effect.flatMap(([settledAccount, contraAccount]) =>
					this.repository
						.getSettlement(organizationId, settlementId)
						.pipe(
							Effect.andThen(
								LedgerAccountSettlementEntity.fromRequest(
									request,
									organizationId,
									settledAccount.currency,
									settledAccount.normalBalance,
									settledAccount.id,
									contraAccount.id,
									settlementId
								)
							)
						)
				),
				Effect.flatMap(entity => this.repository.updateSettlement(entity))
			),
			resultId: settlement => settlement.id.toString(),
			replay: resultId => this.getSettlementByStoredId(organizationId, resultId),
		});
	}

	deleteLedgerAccountSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		idempotencyKey: string
	): Effect.Effect<void, LedgerAccountSettlementDeleteError> {
		return this.idempotency
			.run({
				organizationId,
				action: "settlements.delete",
				key: idempotencyKey,
				execute: this.repository
					.deleteSettlement(organizationId, settlementId)
					.pipe(Effect.as(settlementId)),
				resultId: id => id.toString(),
				replay: () => Effect.succeed(settlementId),
			})
			.pipe(Effect.asVoid);
	}

	addLedgerAccountSettlementEntries(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		idempotencyKey: string,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryError> {
		return this.runEntryMutation(
			organizationId,
			settlementId,
			idempotencyKey,
			"settlements.entries.add",
			this.repository.addEntriesToSettlement(organizationId, settlementId, entryIds)
		);
	}

	removeLedgerAccountSettlementEntries(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		idempotencyKey: string,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryError> {
		return this.runEntryMutation(
			organizationId,
			settlementId,
			idempotencyKey,
			"settlements.entries.remove",
			this.repository.removeEntriesFromSettlement(organizationId, settlementId, entryIds)
		);
	}

	transitionSettlementStatus(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		idempotencyKey: string,
		targetStatus: SettlementStatus
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementTransitionError> {
		return this.idempotency.run({
			organizationId,
			action: "settlements.transition",
			key: idempotencyKey,
			execute: Effect.suspend(() => this.repository.getSettlement(organizationId, settlementId)).pipe(
				Effect.flatMap(settlement => settlement.transitionTo(targetStatus).pipe(Effect.as(settlement))),
				Effect.flatMap(settlement =>
					targetStatus === "pending" && settlement.status === "processing"
						? this.updateAmount(settlement)
						: Effect.succeed(settlement)
				),
				Effect.flatMap(settlement =>
					targetStatus === "posted" && settlement.status === "pending"
						? this.createTransaction(idempotencyKey, ledgerId, settlement)
						: Effect.succeed(settlement)
				),
				Effect.flatMap(() => this.repository.updateStatus(organizationId, settlementId, targetStatus))
			),
			resultId: settlement => settlement.id.toString(),
			replay: resultId => this.getSettlementByStoredId(organizationId, resultId),
		});
	}

	private getAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerAccountSettlementRequest
	) {
		return Effect.all([
			parseId<"lat", LedgerAccountID>("lat", request.settledAccountId),
			parseId<"lat", LedgerAccountID>("lat", request.contraAccountId),
		]).pipe(
			Effect.flatMap(([settledAccountId, contraAccountId]) =>
				Effect.all(
					[
						this.accountService.getAccount(organizationId, ledgerId, settledAccountId),
						this.accountService.getAccount(organizationId, ledgerId, contraAccountId),
					],
					{ concurrency: "unbounded" }
				)
			),
			Effect.flatMap(([settledAccount, contraAccount]) =>
				settledAccount.currency === contraAccount.currency
					? Effect.succeed([settledAccount, contraAccount] as const)
					: Effect.fail(new ConflictError("Settlement accounts must use the same currency"))
			)
		);
	}

	private updateAmount(
		settlement: LedgerAccountSettlementEntity
	): Effect.Effect<
		LedgerAccountSettlementEntity,
		LedgerAccountSettlementReadRepositoryError | LedgerAccountSettlementUpdateRepositoryError
	> {
		return this.repository
			.calculateAmount(settlement.id)
			.pipe(
				Effect.flatMap(amount =>
					this.repository.updateAmount(settlement.organizationId, settlement.id, amount)
				)
			);
	}

	private createTransaction(
		idempotencyKey: string,
		ledgerId: LedgerID,
		settlement: LedgerAccountSettlementEntity
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementTransactionError> {
		return settlement.toTransaction(ledgerId).pipe(
			Effect.flatMap(transaction =>
				this.transactionService.createTransactionEntity(idempotencyKey, transaction)
			),
			Effect.flatMap(transaction =>
				transaction.status === "posted"
					? Effect.succeed(transaction)
					: Effect.fail(new ConflictError("Settlement Transaction must be Posted"))
			),
			Effect.flatMap(transaction =>
				this.repository.linkTransaction(settlement.organizationId, settlement.id, transaction.id)
			)
		);
	}

	private getSettlementByStoredId(organizationId: OrgID, resultId: string) {
		return parseId<"las", LedgerAccountSettlementID>("las", resultId).pipe(
			Effect.flatMap(settlementId => this.repository.getSettlement(organizationId, settlementId))
		);
	}

	private runEntryMutation(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		idempotencyKey: string,
		action: string,
		execute: Effect.Effect<void, LedgerAccountSettlementEntryRepositoryError>
	): Effect.Effect<void, LedgerAccountSettlementEntryError> {
		return this.idempotency
			.run({
				organizationId,
				action,
				key: idempotencyKey,
				execute: execute.pipe(Effect.as(settlementId)),
				resultId: id => id.toString(),
				replay: () => Effect.succeed(settlementId),
			})
			.pipe(Effect.asVoid);
	}
}

const LedgerAccountSettlementServiceTag = Context.Service<LedgerAccountSettlementService>(
	"LedgerAccountSettlementService"
);

const ledgerAccountSettlementServiceLayer = Layer.effect(
	LedgerAccountSettlementServiceTag,
	Effect.gen(function* () {
		const repository = yield* LedgerAccountSettlementRepoTag;
		const ledgerService = yield* LedgerServiceTag;
		const accountService = yield* AccountServiceTag;
		const transactionService = yield* TransactionServiceTag;
		const idempotency = yield* IdempotencyServiceTag;
		return new LedgerAccountSettlementService(
			repository,
			ledgerService,
			accountService,
			transactionService,
			idempotency
		);
	})
);

export type {
	LedgerAccountSettlementCreateError,
	LedgerAccountSettlementDeleteError,
	LedgerAccountSettlementEntryError,
	LedgerAccountSettlementGetError,
	LedgerAccountSettlementListError,
	LedgerAccountSettlementTransactionError,
	LedgerAccountSettlementTransitionError,
	LedgerAccountSettlementUpdateError,
};
export {
	LedgerAccountSettlementService,
	LedgerAccountSettlementServiceTag,
	ledgerAccountSettlementServiceLayer,
};
