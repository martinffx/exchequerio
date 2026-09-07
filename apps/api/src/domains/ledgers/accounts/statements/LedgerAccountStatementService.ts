import { Context, Effect, Layer } from "effect";
import { TypeID } from "typeid-js";

import type { LedgerAccountStatementID, OrgID } from "@/lib/ids";

import { LedgerAccountStatement } from "./LedgerAccountStatement";
import {
	type LedgerAccountStatementRepo,
	LedgerAccountStatementRepoTag,
} from "./LedgerAccountStatementRepo";
import type { LedgerAccountStatementRequest } from "./LedgerAccountStatementSchema";

class LedgerAccountStatementService {
	constructor(private readonly repository: LedgerAccountStatementRepo) {}

	getLedgerAccountStatement(
		id: string,
		orgId: OrgID
	): Effect.Effect<LedgerAccountStatement, unknown> {
		return Effect.sync(() => TypeID.fromString<"lst">(id) as LedgerAccountStatementID).pipe(
			Effect.flatMap(statementId => this.repository.getStatement(statementId, orgId))
		);
	}

	createLedgerAccountStatement(
		request: LedgerAccountStatementRequest,
		orgId: OrgID
	): Effect.Effect<LedgerAccountStatement, unknown> {
		return this.repository
			.getAccountAsset(orgId, request.accountId, request.ledgerId)
			.pipe(
				Effect.flatMap(asset =>
					this.repository.createStatement(LedgerAccountStatement.fromRequest(request, asset), orgId)
				)
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
