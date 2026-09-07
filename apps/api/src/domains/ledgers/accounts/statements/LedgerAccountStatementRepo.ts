import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import { NotFoundError } from "@/lib/errors";
import type { LedgerAccountStatementID } from "@/repo/entities/types";
import { LedgerAccountStatementsTable } from "@/repo/schema";

import { LedgerAccountStatement } from "./LedgerAccountStatement";

interface LedgerAccountStatementRepo {
	readonly getStatement: (
		id: LedgerAccountStatementID
	) => Effect.Effect<LedgerAccountStatement, unknown>;
	readonly createStatement: (
		statement: LedgerAccountStatement
	) => Effect.Effect<LedgerAccountStatement, unknown>;
}

const LedgerAccountStatementRepoTag = Context.Service<LedgerAccountStatementRepo>(
	"LedgerAccountStatementRepo"
);

class LedgerAccountStatementRepoLive implements LedgerAccountStatementRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}

	getStatement(id: LedgerAccountStatementID): Effect.Effect<LedgerAccountStatement, unknown> {
		return this.db
			.select()
			.from(LedgerAccountStatementsTable)
			.where(eq(LedgerAccountStatementsTable.id, id.toString()))
			.limit(1)
			.pipe(
				Effect.flatMap(rows =>
					rows[0] === undefined
						? Effect.fail(new NotFoundError(`Statement not found: ${id.toString()}`))
						: Effect.succeed(LedgerAccountStatement.fromRow(rows[0]))
				)
			);
	}

	createStatement(
		statement: LedgerAccountStatement
	): Effect.Effect<LedgerAccountStatement, unknown> {
		return this.db
			.insert(LedgerAccountStatementsTable)
			.values(statement.toRow())
			.returning()
			.pipe(Effect.map(rows => LedgerAccountStatement.fromRow(rows[0])));
	}
}

const ledgerAccountStatementRepoLayer = Layer.effect(
	LedgerAccountStatementRepoTag,
	DatabaseTag.pipe(Effect.map(database => new LedgerAccountStatementRepoLive(database.effectDb)))
);

export {
	type LedgerAccountStatementRepo,
	LedgerAccountStatementRepoLive,
	LedgerAccountStatementRepoTag,
	ledgerAccountStatementRepoLayer,
};
