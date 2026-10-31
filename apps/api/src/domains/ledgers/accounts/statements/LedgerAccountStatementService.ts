import { Context, Effect, Layer, Option } from "effect";
import type { InvalidId } from "@/lib/errors";
import { parseId } from "@/lib/utils";
import {
	type IdempotencyPending,
	type IdempotencyService,
	type IdempotencyUnavailable,
	IdempotencyServiceTag,
} from "@/lib/IdempotencyService";
import {
	newLedgerAccountStatementID,
	type LedgerAccountID,
	type LedgerAccountStatementID,
	type LedgerID,
	type OrgID,
} from "@/lib/ids";
import type { LedgerAccountStatement } from "./LedgerAccountStatement";
import { validateStatementPeriod } from "./LedgerAccountStatement";
import {
	type LedgerAccountStatementRepo,
	LedgerAccountStatementRepoTag,
	type StatementCreateError,
	type StatementReadError,
	type StatementUpdateError,
} from "./LedgerAccountStatementRepo";
import type {
	LedgerAccountStatementRequest,
	StatementEntry,
	StatementListQuery,
	StatementUpdateRequest,
} from "./LedgerAccountStatementSchema";
import { isStatementInfrastructureError } from "./StatementErrors";

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
	): Effect.Effect<LedgerAccountStatement, StatementReadError> {
		return this.repository.getStatement(organizationId, ledgerId, accountId, id);
	}
	listLedgerAccountStatements(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		query: StatementListQuery
	): Effect.Effect<LedgerAccountStatement[], StatementReadError> {
		return this.repository.listStatements(organizationId, ledgerId, accountId, query);
	}
	getLedgerAccountStatementEntries(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		id: LedgerAccountStatementID,
		query: StatementListQuery
	): Effect.Effect<StatementEntry[], StatementReadError> {
		return this.repository.getEntries(organizationId, ledgerId, accountId, id, query);
	}
	updateLedgerAccountStatement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		id: LedgerAccountStatementID,
		request: StatementUpdateRequest
	): Effect.Effect<LedgerAccountStatement, StatementUpdateError> {
		return this.repository.updateAnnotations(organizationId, ledgerId, accountId, id, request);
	}
	createLedgerAccountStatement(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		key: string,
		request: LedgerAccountStatementRequest
	): Effect.Effect<
		LedgerAccountStatement,
		StatementCreateError | InvalidId | IdempotencyPending | IdempotencyUnavailable
	> {
		return Effect.gen({ self: this }, function* () {
			const period = yield* validateStatementPeriod(request);
			const action = "statements.create";
			const claim = yield* this.idempotency.claim(organizationId, action, key);
			if (Option.isSome(claim)) {
				const id = yield* parseId<"lst", LedgerAccountStatementID>("lst", claim.value);
				return yield* this.repository.getStatement(organizationId, ledgerId, accountId, id);
			}
			const result = yield* this.repository
				.createStatement(
					organizationId,
					ledgerId,
					accountId,
					newLedgerAccountStatementID(),
					request,
					period
				)
				.pipe(
					// An uncertain database outcome must retain its claim, as with Transactions.
					Effect.tapError(error =>
						isStatementInfrastructureError(error)
							? Effect.void
							: this.idempotency.release(organizationId, action, key).pipe(Effect.ignore)
					)
				);
			yield* this.idempotency.complete(organizationId, action, key, result.id.toString());
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
