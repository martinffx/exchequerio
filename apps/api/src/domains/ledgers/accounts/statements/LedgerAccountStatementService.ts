import { Context, Effect, Layer } from "effect";
import { TypeID } from "typeid-js";

import type { LedgerAccountStatementID } from "@/repo/entities/types";

import { LedgerAccountStatement } from "./LedgerAccountStatement";
import {
	type LedgerAccountStatementRepo,
	LedgerAccountStatementRepoTag,
} from "./LedgerAccountStatementRepo";
import type { LedgerAccountStatementRequest } from "./LedgerAccountStatementSchema";

class LedgerAccountStatementService {
	constructor(private readonly repository: LedgerAccountStatementRepo) {}

	getLedgerAccountStatement(id: string): Effect.Effect<LedgerAccountStatement, unknown> {
		return Effect.sync(() => TypeID.fromString<"lst">(id) as LedgerAccountStatementID).pipe(
			Effect.flatMap(statementId => this.repository.getStatement(statementId))
		);
	}

	createLedgerAccountStatement(
		request: LedgerAccountStatementRequest
	): Effect.Effect<LedgerAccountStatement, unknown> {
		return Effect.sync(() => LedgerAccountStatement.fromRequest(request)).pipe(
			Effect.flatMap(statement => this.repository.createStatement(statement))
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
