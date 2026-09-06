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

/**
 * Orchestrates Settlement actions, idempotency, and resumable accounting.
 *
 * @remarks
 * Preparation, accounting, and finalization commit in their respective repositories.
 * No database transaction crosses this service boundary.
 */
class LedgerAccountSettlementService {
	/**
	 * Creates the Settlement application service.
	 *
	 * @param repository - Settlement persistence and source selection.
	 * @param accounts - Account lookup for creation.
	 * @param transactions - Repository owning accounting mutations.
	 * @param idempotency - Action claims and stored resource identifiers.
	 */
	constructor(
		private readonly repository: LedgerAccountSettlementRepo,
		private readonly accounts: AccountService,
		private readonly transactions: LedgerTransactionRepo,
		private readonly idempotency: IdempotencyService
	) {}
	/**
	 * Lists Settlements within one Organization and Ledger.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param offset - Rows to skip.
	 * @param limit - Maximum rows to return.
	 * @returns The repository Effect containing the requested page.
	 */
	listLedgerAccountSettlements(org: OrgID, ledger: LedgerID, offset: number, limit: number) {
		return this.repository.listSettlements(org, ledger, offset, limit);
	}
	/**
	 * Loads a scoped Settlement.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @returns The repository Effect containing the Settlement or a failure.
	 */
	getLedgerAccountSettlement(org: OrgID, ledger: LedgerID, id: LedgerAccountSettlementID) {
		return this.repository.getSettlement(org, ledger, id);
	}
	/**
	 * Decodes an idempotency result ID and reloads its scoped Settlement.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Stored resource identifier.
	 * @returns An Effect containing current state, or an identifier/repository failure.
	 */
	private reload(org: OrgID, ledger: LedgerID, id: string) {
		return parseId<"las", LedgerAccountSettlementID>("las", id).pipe(
			Effect.flatMap(value => this.repository.getSettlement(org, ledger, value))
		);
	}
	/**
	 * Claims a creation action, persists its Settlement, and resumes its initial target.
	 *
	 * @remarks
	 * Stores the Settlement ID before accounting so replay can resume processing.
	 * Known request failures release the claim; uncertain persistence outcomes retain it.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param key - Fresh UUID per client action; reuse only for retries of that action.
	 * @param request - Validated creation request.
	 * @returns An Effect containing current Settlement state, or a claim/domain/persistence failure.
	 */
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
	/**
	 * Claims an edit action and resumes its requested lifecycle target.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param key - Fresh UUID per client action; reuse only for retries of that action.
	 * @param patch - Validated edits and optional target.
	 * @returns An Effect containing current Settlement state, or a claim/domain/persistence failure.
	 */
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
	/**
	 * Resumes accounting only when processing matches this action’s expected target.
	 *
	 * @remarks
	 * An old replay must not advance a later transition. Accounting and finalization
	 * commit separately; failure leaves processing available for a matching retry.
	 *
	 * @param settlement - Current persisted state.
	 * @param expectedTarget - Target requested by the original action, if any.
	 * @returns An Effect containing unchanged or finalized state, or an accounting/persistence failure.
	 */
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
	/**
	 * Adds source membership through an idempotent draft action.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param key - Fresh UUID per client action; reuse only for retries of that action.
	 * @param entries - Source Entry identifiers.
	 * @returns An Effect completing the action, or a claim/membership/persistence failure.
	 */
	addLedgerAccountSettlementEntries(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		key: string,
		entries: string[]
	) {
		return this.changeEntries(org, ledger, id, key, entries, true);
	}
	/**
	 * Removes source membership through an idempotent draft action.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param key - Fresh UUID per client action; reuse only for retries of that action.
	 * @param entries - Source Entry identifiers.
	 * @returns An Effect completing the action, or a claim/membership/persistence failure.
	 */
	removeLedgerAccountSettlementEntries(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		key: string,
		entries: string[]
	) {
		return this.changeEntries(org, ledger, id, key, entries, false);
	}
	/**
	 * Claims a membership action and records its Settlement ID after the edit.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param key - Fresh UUID per client action; reuse only for retries of that action.
	 * @param entries - Source Entry identifiers.
	 * @param add - Whether to add or remove membership.
	 * @returns An Effect completing or replaying the action, or a claim/repository failure.
	 */
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
	/**
	 * Lists sources after enforcing Organization and Ledger scope.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param offset - Rows to skip.
	 * @param limit - Maximum rows to return.
	 * @returns The repository Effect containing source responses.
	 */
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
/** Effect service key for Settlement orchestration. */
const LedgerAccountSettlementServiceTag = Context.Service<LedgerAccountSettlementService>(
	"LedgerAccountSettlementService"
);
/** Constructs Settlement orchestration from Account, repository, and idempotency services. */
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
