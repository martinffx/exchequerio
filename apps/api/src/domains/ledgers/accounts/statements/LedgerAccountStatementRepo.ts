import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DatabaseTag, type EffectDrizzleDatabase, isPostgresUnavailable } from "@/db";
import { AssetsTable, LedgerAccountsTable, LedgerAccountStatementsTable } from "@/db/schema";
import {
	BadRequestError,
	ConflictError,
	HttpError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";
import type { LedgerAccountID, LedgerAccountStatementID, LedgerID, OrgID } from "@/lib/ids";
import { encodeUuid } from "@/lib/utils";
import {
	calculateStatementBalances,
	LedgerAccountStatement,
	type StatementRecord,
	type StatementTotals,
	validateStatementPeriod,
} from "./LedgerAccountStatement";
import {
	type LedgerAccountStatementRequest,
	MAX_STATEMENT_BYTES,
	MAX_STATEMENT_ENTRIES,
	type StatementEntry,
	type StatementListQuery,
	type StatementSnapshot,
	type StatementUpdateRequest,
} from "./LedgerAccountStatementSchema";

type Scope = [organizationId: OrgID, ledgerId: LedgerID, accountId: LedgerAccountID];
interface LedgerAccountStatementRepo {
	getStatement(
		...args: [...Scope, id: LedgerAccountStatementID]
	): Effect.Effect<LedgerAccountStatement, unknown>;
	listStatements(
		...args: [...Scope, query: StatementListQuery]
	): Effect.Effect<LedgerAccountStatement[], unknown>;
	getEntries(
		...args: [...Scope, id: LedgerAccountStatementID, query: StatementListQuery]
	): Effect.Effect<StatementEntry[], unknown>;
	createStatement(
		...args: [...Scope, id: LedgerAccountStatementID, request: LedgerAccountStatementRequest]
	): Effect.Effect<LedgerAccountStatement, unknown>;
	updateAnnotations(
		...args: [...Scope, id: LedgerAccountStatementID, request: StatementUpdateRequest]
	): Effect.Effect<LedgerAccountStatement, unknown>;
}
const LedgerAccountStatementRepoTag = Context.Service<LedgerAccountStatementRepo>(
	"LedgerAccountStatementRepo"
);
const table = LedgerAccountStatementsTable;
const summary = {
	...getTableColumns(table),
	snapshot: sql<StatementRecord["snapshot"]>`${table.snapshot} - 'entries'`,
};
const scopeWhere = (organizationId: OrgID, ledgerId: LedgerID, accountId: LedgerAccountID) =>
	and(
		eq(table.organizationId, encodeUuid(organizationId)),
		eq(table.ledgerId, encodeUuid(ledgerId)),
		eq(table.accountId, encodeUuid(accountId))
	);
const mapError = (cause: unknown) =>
	cause instanceof HttpError
		? cause
		: isPostgresUnavailable(cause)
			? new ServiceUnavailableError("Statement database unavailable", { cause })
			: new InternalServerError("Statement database operation failed", { cause });
const requireStatement = (rows: StatementRecord[], id: LedgerAccountStatementID) =>
	rows[0]
		? Effect.succeed(LedgerAccountStatement.fromRow(rows[0]))
		: Effect.fail(new NotFoundError(`Statement not found: ${id.toString()}`));
// One expression defines both the copied document and its exact serialized byte count.
const entryDocument = sql`jsonb_strip_nulls(jsonb_build_object(
 'id', e.id, 'accountId', e.account_id, 'direction', e.direction, 'amount', e.amount::text,
 'assetId', e.asset_id, 'assetCode', a.code, 'minorUnitExponent', a.minor_unit_exponent, 'metadata', e.metadata::jsonb,
 'created', to_char(e.created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'transaction', jsonb_build_object('id', t.id, 'lockVersion', t.lock_version, 'status', t.status,
 'effectiveAt', to_char(t.effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'description', t.description, 'metadata', t.metadata::jsonb)))`;

class LedgerAccountStatementRepoLive implements LedgerAccountStatementRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}
	getStatement(...[organizationId, ledgerId, accountId, id]: [...Scope, LedgerAccountStatementID]) {
		return this.db
			.select(summary)
			.from(table)
			.where(and(scopeWhere(organizationId, ledgerId, accountId), eq(table.id, encodeUuid(id))))
			.limit(1)
			.pipe(
				Effect.flatMap(rows => requireStatement(rows, id)),
				Effect.mapError(mapError)
			);
	}
	listStatements(...[organizationId, ledgerId, accountId, query]: [...Scope, StatementListQuery]) {
		return Effect.gen({ self: this }, function* () {
			const accounts = yield* this.db
				.select({ id: LedgerAccountsTable.id })
				.from(LedgerAccountsTable)
				.where(
					and(
						eq(LedgerAccountsTable.organizationId, encodeUuid(organizationId)),
						eq(LedgerAccountsTable.ledgerId, encodeUuid(ledgerId)),
						eq(LedgerAccountsTable.id, encodeUuid(accountId))
					)
				)
				.limit(1);
			if (!accounts[0])
				return yield* Effect.fail(new NotFoundError(`Account not found: ${accountId.toString()}`));
			const rows = yield* this.db
				.select(summary)
				.from(table)
				.where(scopeWhere(organizationId, ledgerId, accountId))
				.orderBy(desc(table.created), desc(table.id))
				.limit(query.limit)
				.offset(query.offset);
			return rows.map(row => LedgerAccountStatement.fromRow(row));
		}).pipe(Effect.mapError(mapError));
	}
	getEntries(
		...[organizationId, ledgerId, accountId, id, query]: [
			...Scope,
			LedgerAccountStatementID,
			StatementListQuery,
		]
	) {
		return Effect.gen({ self: this }, function* () {
			yield* this.getStatement(organizationId, ledgerId, accountId, id);
			const rows = yield* this.db
				.select({
					entries: sql<
						StatementEntry[]
					>`(SELECT coalesce(jsonb_agg(page.value ORDER BY page.ordinality), '[]'::jsonb) FROM (SELECT value, ordinality FROM jsonb_array_elements(${table.snapshot}->'entries') WITH ORDINALITY ORDER BY ordinality LIMIT ${query.limit} OFFSET ${query.offset}) page)`,
				})
				.from(table)
				.where(and(scopeWhere(organizationId, ledgerId, accountId), eq(table.id, encodeUuid(id))));
			return rows[0]?.entries ?? [];
		}).pipe(Effect.mapError(mapError));
	}
	createStatement(
		...[organizationId, ledgerId, accountId, id, request]: [
			...Scope,
			LedgerAccountStatementID,
			LedgerAccountStatementRequest,
		]
	) {
		return this.db
			.transaction(
				tx =>
					Effect.gen(function* () {
						const period = yield* Effect.try({
							try: () => validateStatementPeriod(request),
							catch: cause => cause,
						});
						const accounts = yield* tx
							.select({
								normalBalance: LedgerAccountsTable.normalBalance,
								assetId: AssetsTable.id,
								assetCode: AssetsTable.code,
								minorUnitExponent: AssetsTable.minorUnitExponent,
								lockVersion: LedgerAccountsTable.lockVersion,
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
									eq(LedgerAccountsTable.organizationId, encodeUuid(organizationId)),
									eq(LedgerAccountsTable.ledgerId, encodeUuid(ledgerId)),
									eq(LedgerAccountsTable.id, encodeUuid(accountId))
								)
							)
							.limit(1);
						const account = accounts[0];
						if (!account)
							return yield* Effect.fail(new NotFoundError(`Account not found: ${accountId.toString()}`));
						const eligible = sql`FROM ledger_transaction_entries e JOIN ledger_transactions t ON t.id = e.transaction_id AND t.organization_id = e.organization_id AND t.ledger_id = e.ledger_id JOIN assets a ON a.id = e.asset_id AND a.organization_id = e.organization_id WHERE e.organization_id = ${encodeUuid(organizationId)} AND e.ledger_id = ${encodeUuid(ledgerId)} AND e.account_id = ${encodeUuid(accountId)} AND t.status IN ('posted', 'pending')`;
						const totals = yield* tx.execute<{
							opening: boolean;
							status: "posted" | "pending";
							direction: "credit" | "debit";
							amount: string;
						}>(
							sql`SELECT t.effective_at < ${period.startDatetime.toISOString()}::timestamptz AS opening, t.status, e.direction, sum(e.amount)::text AS amount ${eligible} AND t.effective_at < ${period.endDatetime.toISOString()}::timestamptz GROUP BY opening, t.status, e.direction`,
							"objects"
						);
						const opening: StatementTotals = {
							postedCredits: 0n,
							postedDebits: 0n,
							unpostedCredits: 0n,
							unpostedDebits: 0n,
						};
						const closing = { ...opening };
						for (const row of totals) {
							const key =
								`${row.status === "posted" ? "posted" : "unposted"}${row.direction === "credit" ? "Credits" : "Debits"}` as keyof StatementTotals;
							closing[key] += BigInt(row.amount);
							if (row.opening) opening[key] += BigInt(row.amount);
						}
						const header = yield* Effect.try({
							try: () =>
								({
									normalBalance: account.normalBalance,
									assetId: account.assetId,
									assetCode: account.assetCode,
									minorUnitExponent: account.minorUnitExponent,
									startingBalances: calculateStatementBalances(account.normalBalance, opening),
									endingBalances: calculateStatementBalances(account.normalBalance, closing),
									entries: [],
								}) satisfies StatementSnapshot,
							catch: cause => cause,
						});
						const inPeriod = sql`${eligible} AND t.effective_at >= ${period.startDatetime.toISOString()}::timestamptz AND t.effective_at < ${period.endDatetime.toISOString()}::timestamptz`;
						const sizes = yield* tx.execute<{ count: string; bytes: string }>(
							sql`SELECT count(*)::text AS count, (octet_length((${JSON.stringify(header)}::jsonb)::text) + coalesce(sum(octet_length((${entryDocument})::text)), 0) + greatest(count(*) - 1, 0) * 2)::text AS bytes ${inPeriod}`,
							"objects"
						);
						if (
							Number(sizes[0]?.count) > MAX_STATEMENT_ENTRIES ||
							Number(sizes[0]?.bytes) > MAX_STATEMENT_BYTES
						)
							return yield* Effect.fail(
								new BadRequestError(
									`Statement exceeds ${MAX_STATEMENT_ENTRIES} Entries or ${MAX_STATEMENT_BYTES} serialized bytes`
								)
							);
						const rows = yield* tx
							.insert(table)
							.values({
								id: encodeUuid(id),
								organizationId: encodeUuid(organizationId),
								ledgerId: encodeUuid(ledgerId),
								accountId: encodeUuid(accountId),
								...period,
								ledgerAccountVersion: account.lockVersion,
								description: request.description,
								metadata: request.metadata,
								snapshot: sql`${JSON.stringify(header)}::jsonb || jsonb_build_object('entries', (SELECT coalesce(jsonb_agg(${entryDocument} ORDER BY t.effective_at, e.id), '[]'::jsonb) ${inPeriod}))`,
							})
							.returning(summary);
						return yield* requireStatement(rows, id);
					}),
				{ isolationLevel: "repeatable read" }
			)
			.pipe(Effect.mapError(mapError));
	}
	updateAnnotations(
		...[organizationId, ledgerId, accountId, id, request]: [
			...Scope,
			LedgerAccountStatementID,
			StatementUpdateRequest,
		]
	) {
		return Effect.gen({ self: this }, function* () {
			yield* this.getStatement(organizationId, ledgerId, accountId, id);
			const rows = yield* this.db
				.update(table)
				.set({
					// oxlint-disable-next-line unicorn/no-null -- SQL null clears omitted annotations.
					description: request.description ?? null,
					// oxlint-disable-next-line unicorn/no-null -- SQL null clears omitted annotations.
					metadata: request.metadata ?? null,
					lockVersion: sql`${table.lockVersion} + 1`,
					updated: new Date(),
				})
				.where(
					and(
						scopeWhere(organizationId, ledgerId, accountId),
						eq(table.id, encodeUuid(id)),
						eq(table.lockVersion, request.lockVersion)
					)
				)
				.returning(summary);
			if (!rows[0])
				return yield* Effect.fail(
					new ConflictError("Statement annotations were modified; reload and retry")
				);
			return LedgerAccountStatement.fromRow(rows[0]);
		}).pipe(Effect.mapError(mapError));
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
