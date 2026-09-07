import { Context, Effect, Layer, Option } from "effect";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { parseId } from "@/lib/utils";
import { type IdempotencyService, IdempotencyServiceTag } from "@/lib/IdempotencyService";
import {
	newLedgerAccountStatementID,
	type LedgerAccountID,
	type LedgerAccountStatementID,
	type LedgerID,
	type OrgID,
} from "@/lib/ids";
import { validateStatementPeriod } from "./LedgerAccountStatement";
import {
	type LedgerAccountStatementRepo,
	LedgerAccountStatementRepoTag,
} from "./LedgerAccountStatementRepo";
import type {
	LedgerAccountStatementRequest,
	StatementListQuery,
	StatementUpdateRequest,
} from "./LedgerAccountStatementSchema";

/** Orchestrates scoped Statements and replay-safe generation. */
class LedgerAccountStatementService {
	constructor(
		private readonly repository: LedgerAccountStatementRepo,
		private readonly idempotency: IdempotencyService
	) {}

	getLedgerAccountStatement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		id: LedgerAccountStatementID
	) {
		return this.repository.getStatement(organizationId, ledgerId, accountId, id);
	}
	listLedgerAccountStatements(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		query: StatementListQuery
	) {
		return this.repository.listStatements(organizationId, ledgerId, accountId, query);
	}
	getLedgerAccountStatementEntries(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		id: LedgerAccountStatementID,
		query: StatementListQuery
	) {
		return this.repository.getEntries(organizationId, ledgerId, accountId, id, query);
	}
	updateLedgerAccountStatement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		id: LedgerAccountStatementID,
		request: StatementUpdateRequest
	) {
		return this.repository.updateAnnotations(organizationId, ledgerId, accountId, id, request);
	}
	createLedgerAccountStatement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		key: string,
		request: LedgerAccountStatementRequest
	) {
		return Effect.gen({ self: this }, function* () {
			yield* Effect.try({ try: () => validateStatementPeriod(request), catch: error => error });
			const action = "statements.create";
			const claim = yield* this.idempotency.claim(organizationId, action, key);
			if (Option.isSome(claim)) {
				const id = yield* parseId<"lst", LedgerAccountStatementID>("lst", claim.value);
				return yield* this.repository.getStatement(organizationId, ledgerId, accountId, id);
			}
			const result = yield* this.repository
				.createStatement(organizationId, ledgerId, accountId, newLedgerAccountStatementID(), request)
				.pipe(
					// An uncertain database outcome must retain its claim, as with Transactions.
					Effect.tapError(error =>
						error instanceof BadRequestError || error instanceof NotFoundError
							? this.idempotency.release(organizationId, action, key).pipe(Effect.ignore)
							: Effect.void
					)
				);
			yield* this.idempotency.complete(organizationId, action, key, result.id);
			return result;
		});
	}
}
const LedgerAccountStatementServiceTag = Context.Service<LedgerAccountStatementService>(
	"LedgerAccountStatementService"
);
const ledgerAccountStatementServiceLayer = Layer.effect(
	LedgerAccountStatementServiceTag,
	Effect.gen(function* () {
		return new LedgerAccountStatementService(
			yield* LedgerAccountStatementRepoTag,
			yield* IdempotencyServiceTag
		);
	})
);
export {
	LedgerAccountStatementService,
	LedgerAccountStatementServiceTag,
	ledgerAccountStatementServiceLayer,
};
