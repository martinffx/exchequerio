import { Context, Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";
import { type AccountService, AccountServiceTag } from "../accounts/AccountService";
import {
	type LedgerTransactionRepo,
	LedgerTransactionRepoTag,
} from "../transactions/LedgerTransactionRepo";
import { HttpError } from "@/lib/errors";
import { parseId } from "@/lib/utils";
import type {
	LedgerAccountID,
	LedgerAccountSettlementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import { type IdempotencyService, IdempotencyServiceTag } from "@/services/IdempotencyService";
import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import {
	type LedgerAccountSettlementRepo,
	LedgerAccountSettlementRepoTag,
} from "./LedgerAccountSettlementRepo";
import type {
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementPatchRequest,
} from "./LedgerAccountSettlementSchema";

class LedgerAccountSettlementService {
	constructor(
		private readonly repository: LedgerAccountSettlementRepo,
		private readonly accounts: AccountService,
		private readonly transactions: LedgerTransactionRepo,
		private readonly idempotency: IdempotencyService
	) {}
	listLedgerAccountSettlements(org: OrgID, ledger: LedgerID, offset: number, limit: number) {
		return this.repository.listSettlements(org, ledger, offset, limit);
	}
	getLedgerAccountSettlement(org: OrgID, ledger: LedgerID, id: LedgerAccountSettlementID) {
		return this.repository.getSettlement(org, ledger, id);
	}
	private reload(org: OrgID, ledger: LedgerID, id: string) {
		return parseId<"las", LedgerAccountSettlementID>("las", id).pipe(
			Effect.flatMap(value => this.repository.getSettlement(org, ledger, value))
		);
	}
	createLedgerAccountSettlement(
		org: OrgID,
		ledger: LedgerID,
		key: string,
		request: LedgerAccountSettlementRequest
	) {
		return Effect.gen({ self: this }, function* () {
			const action = "settlements.create";
			const claim = yield* this.idempotency.claim(org, action, key);
			if (Option.isSome(claim))
				return yield* this.reload(org, ledger, claim.value).pipe(
					Effect.flatMap(settlement => this.resume(settlement, request.status ?? "pending"))
				);
			const settlement = yield* Effect.gen({ self: this }, function* () {
				const accountId = yield* parseId<"lat", LedgerAccountID>("lat", request.settledAccountId);
				const account = yield* this.accounts.getAccount(org, ledger, accountId);
				const now = DateTime.utc();
				const entity = yield* LedgerAccountSettlementEntity.fromRequest(
					org,
					ledger,
					request,
					account.currency,
					now
				);
				return yield* this.repository.createSettlement(
					entity,
					request.status === "drafting" ? undefined : (request.status ?? "pending"),
					now
				);
			}).pipe(
				Effect.tapError(error =>
					error instanceof HttpError && error.statusCode < 500
						? this.idempotency.release(org, action, key).pipe(Effect.ignore)
						: Effect.void
				)
			);
			yield* this.idempotency.complete(org, action, key, settlement.id.toString());
			return yield* this.resume(settlement, request.status ?? "pending");
		});
	}
	patchLedgerAccountSettlement(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		key: string,
		patch: LedgerAccountSettlementPatchRequest
	) {
		return Effect.gen({ self: this }, function* () {
			const action = "settlements.patch";
			const claim = yield* this.idempotency.claim(org, action, key);
			if (Option.isSome(claim))
				return yield* this.reload(org, ledger, claim.value).pipe(
					Effect.flatMap(settlement => this.resume(settlement, patch.status))
				);
			const settlement = yield* this.repository
				.prepareSettlement(org, ledger, id, patch, DateTime.utc())
				.pipe(
					Effect.tapError(error =>
						error.statusCode < 500
							? this.idempotency.release(org, action, key).pipe(Effect.ignore)
							: Effect.void
					)
				);
			yield* this.idempotency.complete(org, action, key, settlement.id.toString());
			return yield* this.resume(settlement, patch.status);
		});
	}
	private resume(settlement: LedgerAccountSettlementEntity, expectedTarget: string | undefined) {
		return Effect.gen({ self: this }, function* () {
			if (
				settlement.status !== "processing" ||
				!settlement.targetStatus ||
				settlement.targetStatus !== expectedTarget
			)
				return settlement;
			const org = settlement.organizationId,
				ledger = settlement.ledgerId,
				id = settlement.id;
			const now = DateTime.utc();
			const existing = yield* this.transactions.getSettlementTransaction(org, ledger, id);
			if (Option.isNone(existing)) {
				const accounting = yield* this.repository.buildTransaction(org, ledger, id, now);
				yield* this.transactions.createSettlementTransaction(accounting);
			} else if (settlement.targetStatus === "posted")
				yield* this.transactions.postSettlementTransaction(org, ledger, id, now);
			else if (settlement.targetStatus === "voided")
				yield* this.transactions.voidSettlementTransaction(org, ledger, id, now);
			return yield* this.repository.finalizeSettlement(
				org,
				ledger,
				id,
				settlement.targetStatus,
				DateTime.utc()
			);
		});
	}
	addLedgerAccountSettlementEntries(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		key: string,
		entries: string[]
	) {
		return this.changeEntries(org, ledger, id, key, entries, true);
	}
	removeLedgerAccountSettlementEntries(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		key: string,
		entries: string[]
	) {
		return this.changeEntries(org, ledger, id, key, entries, false);
	}
	private changeEntries(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		key: string,
		entries: string[],
		add: boolean
	) {
		return Effect.gen({ self: this }, function* () {
			const action = add ? "settlements.entries.add" : "settlements.entries.remove";
			const claim = yield* this.idempotency.claim(org, action, key);
			if (Option.isSome(claim)) {
				yield* this.reload(org, ledger, claim.value);
				return;
			}
			yield* this.repository
				.changeEntries(org, ledger, id, entries, add)
				.pipe(
					Effect.tapError(error =>
						error.statusCode < 500
							? this.idempotency.release(org, action, key).pipe(Effect.ignore)
							: Effect.void
					)
				);
			yield* this.idempotency.complete(org, action, key, id.toString());
		});
	}
	listLedgerAccountSettlementEntries(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		offset: number,
		limit: number
	) {
		return this.repository.listEntries(org, ledger, id, offset, limit);
	}
}
const LedgerAccountSettlementServiceTag = Context.Service<LedgerAccountSettlementService>(
	"LedgerAccountSettlementService"
);
const ledgerAccountSettlementServiceLayer = Layer.effect(
	LedgerAccountSettlementServiceTag,
	Effect.gen(function* () {
		return new LedgerAccountSettlementService(
			yield* LedgerAccountSettlementRepoTag,
			yield* AccountServiceTag,
			yield* LedgerTransactionRepoTag,
			yield* IdempotencyServiceTag
		);
	})
);
export {
	LedgerAccountSettlementService,
	LedgerAccountSettlementServiceTag,
	ledgerAccountSettlementServiceLayer,
};
