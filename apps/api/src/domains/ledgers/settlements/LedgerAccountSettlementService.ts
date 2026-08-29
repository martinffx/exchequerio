import { Context, Effect, Layer } from "effect";
import { TypeID } from "typeid-js";

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
import type { TransactionCreateRequest } from "@/domains/ledgers/transactions/LedgerTransactionSchema";
import { ConflictError } from "@/lib/errors";
import type { LedgerAccountSettlementID, LedgerID, OrgID } from "@/repo/entities/types";

import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
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
	| LedgerAccountSettlementCreateRepositoryError;
type LedgerAccountSettlementUpdateError =
	| AccountGetError
	| ConflictError
	| LedgerAccountSettlementGetRepositoryError
	| LedgerAccountSettlementUpdateRepositoryError;
type LedgerAccountSettlementDeleteError = LedgerAccountSettlementDeleteRepositoryError;
type LedgerAccountSettlementEntryError = LedgerAccountSettlementEntryRepositoryError;
type LedgerAccountSettlementTransitionError =
	| ConflictError
	| LedgerAccountSettlementGetRepositoryError
	| LedgerAccountSettlementReadRepositoryError
	| LedgerAccountSettlementStatusRepositoryError
	| LedgerAccountSettlementUpdateRepositoryError
	| TransactionCreateError;

interface LedgerAccountSettlementService {
	listLedgerAccountSettlements(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Effect.Effect<LedgerAccountSettlementEntity[], LedgerAccountSettlementListError>;
	getLedgerAccountSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementGetError>;
	createLedgerAccountSettlement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerAccountSettlementRequest
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementCreateError>;
	updateLedgerAccountSettlement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		request: LedgerAccountSettlementRequest
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementUpdateError>;
	deleteLedgerAccountSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<void, LedgerAccountSettlementDeleteError>;
	addLedgerAccountSettlementEntries(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryError>;
	removeLedgerAccountSettlementEntries(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryError>;
	transitionSettlementStatus(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		targetStatus: SettlementStatus
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementTransitionError>;
}

const LedgerAccountSettlementServiceTag = Context.Service<LedgerAccountSettlementService>(
	"LedgerAccountSettlementService"
);

class LedgerAccountSettlementServiceLive implements LedgerAccountSettlementService {
	constructor(
		private readonly repository: LedgerAccountSettlementRepo,
		private readonly ledgerService: LedgerService,
		private readonly accountService: AccountService,
		private readonly transactionService: TransactionService
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
		request: LedgerAccountSettlementRequest
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementCreateError> {
		return this.getAccounts(organizationId, ledgerId, request).pipe(
			Effect.flatMap(([settledAccount]) =>
				Effect.sync(() =>
					LedgerAccountSettlementEntity.fromRequest(
						request,
						organizationId,
						settledAccount.currency,
						settledAccount.normalBalance
					)
				)
			),
			Effect.flatMap(entity => this.repository.createSettlement(entity))
		);
	}

	updateLedgerAccountSettlement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		request: LedgerAccountSettlementRequest
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementUpdateError> {
		return this.getAccounts(organizationId, ledgerId, request).pipe(
			Effect.flatMap(([settledAccount]) =>
				this.repository
					.getSettlement(organizationId, settlementId)
					.pipe(
						Effect.andThen(
							Effect.sync(() =>
								LedgerAccountSettlementEntity.fromRequest(
									request,
									organizationId,
									settledAccount.currency,
									settledAccount.normalBalance,
									settlementId.toString()
								)
							)
						)
					)
			),
			Effect.flatMap(entity => this.repository.updateSettlement(entity))
		);
	}

	deleteLedgerAccountSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<void, LedgerAccountSettlementDeleteError> {
		return this.repository.deleteSettlement(organizationId, settlementId);
	}

	addLedgerAccountSettlementEntries(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryError> {
		return this.repository.addEntriesToSettlement(organizationId, settlementId, entryIds);
	}

	removeLedgerAccountSettlementEntries(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryError> {
		return this.repository.removeEntriesFromSettlement(organizationId, settlementId, entryIds);
	}

	transitionSettlementStatus(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		targetStatus: SettlementStatus
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementTransitionError> {
		return Effect.suspend(() => this.repository.getSettlement(organizationId, settlementId)).pipe(
			Effect.flatMap(settlement =>
				this.validateStatusTransition(settlement.status, targetStatus).pipe(
					Effect.flatMap(() =>
						targetStatus === "pending" && settlement.status === "processing"
							? this.updateAmount(settlement)
							: Effect.void
					),
					Effect.flatMap(() =>
						targetStatus === "posted" && settlement.status === "pending"
							? this.createTransaction(organizationId, ledgerId, settlement)
							: Effect.void
					),
					Effect.flatMap(() => this.repository.updateStatus(organizationId, settlementId, targetStatus))
				)
			)
		);
	}

	private getAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerAccountSettlementRequest
	) {
		return Effect.all(
			[
				this.accountService.getAccount(
					organizationId,
					ledgerId,
					TypeID.fromString<"lat">(request.settledAccountId)
				),
				this.accountService.getAccount(
					organizationId,
					ledgerId,
					TypeID.fromString<"lat">(request.contraAccountId)
				),
			],
			{ concurrency: "unbounded" }
		).pipe(
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
		void,
		LedgerAccountSettlementReadRepositoryError | LedgerAccountSettlementUpdateRepositoryError
	> {
		return this.repository.calculateAmount(settlement.id).pipe(
			Effect.flatMap(amount => Effect.sync(() => settlement.withAmount(amount))),
			Effect.flatMap(updated => this.repository.updateSettlement(updated)),
			Effect.asVoid
		);
	}

	private createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlement: LedgerAccountSettlementEntity
	): Effect.Effect<
		void,
		ConflictError | LedgerAccountSettlementUpdateRepositoryError | TransactionCreateError
	> {
		const request: TransactionCreateRequest = {
			status: "posted",
			description: settlement.description ?? `Settlement ${settlement.id.toString()}`,
			metadata: {
				...(settlement.metadata as Record<string, string> | undefined),
				settlementId: settlement.id.toString(),
			},
			ledgerEntries: [
				{
					accountId: settlement.settledAccountId.toString(),
					direction: settlement.normalBalance === "debit" ? "credit" : "debit",
					amount: settlement.amount,
					currencyCode: settlement.currency,
					metadata: {},
				},
				{
					accountId: settlement.contraAccountId.toString(),
					direction: settlement.normalBalance === "debit" ? "debit" : "credit",
					amount: settlement.amount,
					currencyCode: settlement.currency,
					metadata: {},
				},
			],
		};

		return this.transactionService
			.createTransaction(organizationId, ledgerId, `settlement:${settlement.id.toString()}`, request)
			.pipe(
				Effect.flatMap(transaction =>
					transaction.status === "posted"
						? Effect.succeed(transaction)
						: Effect.fail(new ConflictError("Settlement Transaction must be Posted"))
				),
				Effect.flatMap(transaction => Effect.sync(() => settlement.withTransactionId(transaction.id))),
				Effect.flatMap(updated => this.repository.updateSettlement(updated)),
				Effect.asVoid
			);
	}

	private validateStatusTransition(
		currentStatus: SettlementStatus,
		targetStatus: SettlementStatus
	): Effect.Effect<void, ConflictError> {
		const transitions: Record<SettlementStatus, readonly SettlementStatus[]> = {
			drafting: ["processing"],
			processing: ["pending", "drafting"],
			pending: ["posted", "drafting"],
			posted: ["archiving"],
			archiving: ["archived"],
			archived: [],
		};
		return transitions[currentStatus].includes(targetStatus)
			? Effect.void
			: Effect.fail(
					new ConflictError(`Invalid status transition from '${currentStatus}' to '${targetStatus}'`)
				);
	}
}

const ledgerAccountSettlementServiceLayer = Layer.effect(
	LedgerAccountSettlementServiceTag,
	Effect.gen(function* () {
		const repository = yield* LedgerAccountSettlementRepoTag;
		const ledgerService = yield* LedgerServiceTag;
		const accountService = yield* AccountServiceTag;
		const transactionService = yield* TransactionServiceTag;
		return new LedgerAccountSettlementServiceLive(
			repository,
			ledgerService,
			accountService,
			transactionService
		);
	})
);

export type {
	LedgerAccountSettlementCreateError,
	LedgerAccountSettlementDeleteError,
	LedgerAccountSettlementEntryError,
	LedgerAccountSettlementGetError,
	LedgerAccountSettlementListError,
	LedgerAccountSettlementService,
	LedgerAccountSettlementTransitionError,
	LedgerAccountSettlementUpdateError,
};
export {
	LedgerAccountSettlementServiceLive,
	LedgerAccountSettlementServiceTag,
	ledgerAccountSettlementServiceLayer,
};
