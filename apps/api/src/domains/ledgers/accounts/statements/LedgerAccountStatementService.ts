import { Context, Effect, Layer } from "effect";
import { TypeID } from "typeid-js";

import type { LedgerAccountStatementID, OrgID } from "@/lib/ids";

import { LedgerAccountStatement } from "./LedgerAccountStatement";
import {
	type LedgerAccountStatementRepo,
	type StatementError,
	LedgerAccountStatementRepoTag,
} from "./LedgerAccountStatementRepo";
import type { LedgerAccountStatementRequest } from "./LedgerAccountStatementSchema";

class LedgerAccountStatementService {
	constructor(private readonly repository: LedgerAccountStatementRepo) {}

	getLedgerAccountStatement(
		id: string,
		orgId: OrgID
	): Effect.Effect<LedgerAccountStatement, StatementError> {
		return Effect.sync(() => TypeID.fromString<"lst">(id) as LedgerAccountStatementID).pipe(
			Effect.flatMap(statementId => this.repository.getStatement(statementId, orgId)),
			Effect.withSpan("LedgerAccountStatementService.getLedgerAccountStatement", {
				attributes: { "organization.id": String(orgId) },
			})
		);
	}

	createLedgerAccountStatement(
		request: LedgerAccountStatementRequest,
		orgId: OrgID
	): Effect.Effect<LedgerAccountStatement, StatementError> {
		return this.repository.getAccountAsset(orgId, request.accountId, request.ledgerId).pipe(
			Effect.flatMap(asset =>
				this.repository.createStatement(LedgerAccountStatement.fromRequest(request, asset), orgId)
			),
			Effect.withSpan("LedgerAccountStatementService.createLedgerAccountStatement", {
				attributes: { "organization.id": String(orgId) },
			})
		);
	}
}

const LedgerAccountStatementServiceTag = Context.Service<LedgerAccountStatementService>(
	"LedgerAccountStatementService"
);

const ledgerAccountStatementServiceLayer = Layer.effect(
	LedgerAccountStatementServiceTag,
	LedgerAccountStatementRepoTag.pipe(
		Effect.map(repository => new LedgerAccountStatementService(repository))
	)
);

export {
	LedgerAccountStatementService,
	LedgerAccountStatementServiceTag,
	ledgerAccountStatementServiceLayer,
};
