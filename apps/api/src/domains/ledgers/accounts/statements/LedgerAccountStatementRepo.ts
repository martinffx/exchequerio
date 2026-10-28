import { TypeID } from "typeid-js";
import { encodeUuid } from "@/lib/utils";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import type { AssetSummary } from "@/lib/AssetSchema";
import type {
	BadRequestError,
	ConflictError,
	InternalServerError,
	ServiceUnavailableError,
} from "@/lib/errors";
import { NotFoundError } from "@/lib/errors";
import type { LedgerAccountStatementID, OrgID } from "@/lib/ids";
import { AssetsTable, LedgerAccountsTable, LedgerAccountStatementsTable } from "@/db/schema";

import { LedgerAccountStatement } from "./LedgerAccountStatement";

/**
 * Problems a Statement repository call may fail with; the HttpApi group declares each. Type-only:
 * database failures still pass through unchanged and render as a sanitised 500.
 */
type StatementRepoError =
	| BadRequestError
	| ConflictError
	| InternalServerError
	| NotFoundError
	| ServiceUnavailableError;

/** Read failures; reads take no locks and never conflict. */
type StatementReadError = Exclude<StatementRepoError, ConflictError>;

interface LedgerAccountStatementRepo {
	readonly getAccountAsset: (
		orgId: OrgID,
		accountId: string,
		ledgerId: string
	) => Effect.Effect<AssetSummary, StatementReadError>;
	readonly getStatement: (
		id: LedgerAccountStatementID,
		orgId: OrgID
	) => Effect.Effect<LedgerAccountStatement, StatementReadError>;
	readonly createStatement: (
		statement: LedgerAccountStatement,
		orgId: OrgID
	) => Effect.Effect<LedgerAccountStatement, StatementRepoError>;
}

const LedgerAccountStatementRepoTag = Context.Service<LedgerAccountStatementRepo>(
	"LedgerAccountStatementRepo"
);

class LedgerAccountStatementRepoLive implements LedgerAccountStatementRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}

	getAccountAsset(
		orgId: OrgID,
		accountId: string,
		ledgerId: string
	): Effect.Effect<AssetSummary, StatementReadError> {
		return this.db
			.select({
				assetId: AssetsTable.id,
				assetCode: AssetsTable.code,
				minorUnitExponent: AssetsTable.minorUnitExponent,
			})
			.from(LedgerAccountsTable)
			.innerJoin(
				AssetsTable,
				and(
					eq(AssetsTable.id, LedgerAccountsTable.assetId),
					eq(AssetsTable.organizationId, LedgerAccountsTable.organizationId)
				)
			)
			.where(
				and(
					eq(LedgerAccountsTable.id, encodeUuid(TypeID.fromString(accountId))),
					eq(LedgerAccountsTable.ledgerId, encodeUuid(TypeID.fromString(ledgerId))),
					eq(LedgerAccountsTable.organizationId, encodeUuid(orgId))
				)
			)
			.limit(1)
			.pipe(
				Effect.flatMap(rows =>
					rows[0] === undefined
						? Effect.fail(new NotFoundError("Account not found"))
						: Effect.succeed({ ...rows[0], assetId: TypeID.fromUUID("ast", rows[0].assetId).toString() })
				)
			) as Effect.Effect<AssetSummary, StatementReadError>;
	}

	getStatement(
		id: LedgerAccountStatementID,
		orgId: OrgID
	): Effect.Effect<LedgerAccountStatement, StatementReadError> {
		return this.db
			.select()
			.from(LedgerAccountStatementsTable)
			.where(eq(LedgerAccountStatementsTable.id, encodeUuid(id)))
			.limit(1)
			.pipe(
				Effect.flatMap(rows => {
					const row = rows[0];
					if (row === undefined)
						return Effect.fail(new NotFoundError(`Statement not found: ${id.toString()}`));
					return this.getAccountAsset(
						orgId,
						TypeID.fromUUID("lat", row.accountId).toString(),
						TypeID.fromUUID("lgr", row.ledgerId).toString()
					).pipe(Effect.map(asset => LedgerAccountStatement.fromRow(row, asset)));
				})
			) as Effect.Effect<LedgerAccountStatement, StatementReadError>;
	}

	createStatement(
		statement: LedgerAccountStatement,
		orgId: OrgID
	): Effect.Effect<LedgerAccountStatement, StatementRepoError> {
		return this.db
			.insert(LedgerAccountStatementsTable)
			.values(statement.toRow())
			.returning()
			.pipe(Effect.flatMap(() => this.getStatement(statement.id, orgId))) as Effect.Effect<
			LedgerAccountStatement,
			StatementRepoError
		>;
	}
}

const ledgerAccountStatementRepoLayer = Layer.effect(
	LedgerAccountStatementRepoTag,
	DatabaseTag.pipe(Effect.map(database => new LedgerAccountStatementRepoLive(database.effectDb)))
);

export type { StatementReadError, StatementRepoError };
export {
	type LedgerAccountStatementRepo,
	LedgerAccountStatementRepoLive,
	LedgerAccountStatementRepoTag,
	ledgerAccountStatementRepoLayer,
};
