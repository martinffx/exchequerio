import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import {
	DatabaseTag,
	type EffectDrizzleDatabase,
	isPostgresUnavailable,
	postgresErrorCode,
} from "@/db";
import {
	BadRequestError,
	ConflictError,
	HttpError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";
import { encodeUuid, encodeMetadata, parseMetadata } from "@/lib/utils";
import type { LedgerAccountSettlementID, LedgerID, OrgID } from "@/lib/ids";
import {
	LedgerAccountSettlementEntriesTable as Links,
	LedgerAccountSettlementsTable as Settlements,
	LedgerAccountsTable as Accounts,
	LedgerTransactionEntriesTable as Entries,
	LedgerTransactionsTable as Transactions,
} from "@/db/schema";
import { LedgerTransaction } from "../transactions/LedgerTransaction";
import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import type {
	LedgerAccountSettlementEntryResponse,
	LedgerAccountSettlementPatchRequest,
	SettlementTargetStatus,
} from "./LedgerAccountSettlementSchema";

/** Operations used by repository helpers with a database or its current transaction. */
type Connection = Pick<EffectDrizzleDatabase, "select" | "insert" | "update" | "delete" | "query">;
/** Builds the Organization, Ledger, and Settlement ownership predicate. */
const scope = (organizationId: OrgID, ledgerId: LedgerID, id: LedgerAccountSettlementID) =>
	and(
		eq(Settlements.organizationId, encodeUuid(organizationId)),
		eq(Settlements.ledgerId, encodeUuid(ledgerId)),
		eq(Settlements.id, encodeUuid(id))
	);
/** Preserves HTTP failures and translates PostgreSQL failures at the repository boundary. */
const mapError = (cause: unknown): HttpError => {
	if (cause instanceof HttpError) return cause;
	const code = postgresErrorCode(cause);
	if (code === "23503")
		return new NotFoundError("Referenced Ledger or Account not found", { cause });
	if (["23505", "23514", "40001", "40P01"].includes(code ?? ""))
		return new ConflictError("Settlement conflicts with existing state", { cause });
	return isPostgresUnavailable(cause)
		? new ServiceUnavailableError("Settlement repository unavailable", { cause })
		: new InternalServerError("Settlement persistence failed", { cause });
};
/**
 * Persists Settlement state and source membership.
 *
 * @remarks
 * Mutations own their database transactions. Accounting commits separately through
 * the Transaction repository; processing state preserves the target for retries.
 */
class LedgerAccountSettlementRepoLive {
	/**
	 * Creates a Settlement repository.
	 *
	 * @param db - Effect-enabled database for Settlement persistence.
	 */
	constructor(private readonly db: EffectDrizzleDatabase) {}
	/**
	 * Loads scoped Settlement state and its generated accounting.
	 *
	 * @param db - Repository connection or current transaction.
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param lock - Whether to lock the Settlement row for update.
	 * @returns An Effect containing the Settlement, or a missing-row/persistence failure.
	 */
	private read(
		db: Connection,
		organizationId: OrgID,
		ledgerId: LedgerID,
		id: LedgerAccountSettlementID,
		lock = false
	): Effect.Effect<LedgerAccountSettlementEntity, HttpError> {
		return Effect.gen(function* () {
			const query = db
				.select()
				.from(Settlements)
				.where(scope(organizationId, ledgerId, id))
				.limit(1);
			const rows = yield* lock ? query.for("update") : query;
			const row = rows[0];
			if (!row) return yield* Effect.fail(new NotFoundError("Settlement not found"));
			const transactions = yield* db.query.LedgerTransactionsTable.findMany({
				where: {
					organizationId: encodeUuid(organizationId),
					ledgerId: encodeUuid(ledgerId),
					settlementId: encodeUuid(id),
				},
				with: { entries: true },
			});
			const accounting = yield* LedgerTransaction.fromRows(transactions);
			const entity = yield* LedgerAccountSettlementEntity.fromRow(
				row,
				Option.getOrUndefined(accounting)
			);
			return Option.getOrThrow(entity);
		}).pipe(Effect.mapError(mapError));
	}
	/**
	 * Gets a Settlement with its accounting.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @returns An Effect containing the Settlement, or a missing-row/persistence failure.
	 */
	getSettlement(organizationId: OrgID, ledgerId: LedgerID, id: LedgerAccountSettlementID) {
		return this.read(this.db, organizationId, ledgerId, id);
	}
	/**
	 * Lists scoped Settlements with accounting in descending creation and ID order.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param offset - Rows to skip.
	 * @param limit - Maximum rows to return.
	 * @returns An Effect containing the decoded page, or a persistence failure.
	 */
	listSettlements(organizationId: OrgID, ledgerId: LedgerID, offset: number, limit: number) {
		return this.db.query.LedgerAccountSettlementsTable.findMany({
			where: { organizationId: encodeUuid(organizationId), ledgerId: encodeUuid(ledgerId) },
			orderBy: { created: "desc", id: "desc" },
			offset,
			limit,
			with: { transaction: { with: { entries: true } } },
		}).pipe(
			Effect.flatMap(rows =>
				Effect.forEach(rows, row =>
					Effect.gen(function* () {
						const accounting = row.transaction
							? Option.getOrUndefined(yield* LedgerTransaction.fromRows([row.transaction]))
							: undefined;
						return Option.getOrThrow(yield* LedgerAccountSettlementEntity.fromRow(row, accounting));
					})
				)
			),
			Effect.mapError(mapError)
		);
	}
	/**
	 * Queries assigned source Entries in descending creation and ID order.
	 *
	 * @param db - Repository connection or current transaction.
	 * @param settlement - Scoped Settlement whose sources are read.
	 * @returns The source query, including parent Transaction effective times.
	 */
	private sources(db: Connection, settlement: LedgerAccountSettlementEntity) {
		return db
			.select({ entry: Entries, effectiveAt: Transactions.effectiveAt })
			.from(Links)
			.innerJoin(Entries, eq(Entries.id, Links.entryId))
			.innerJoin(Transactions, eq(Transactions.id, Entries.transactionId))
			.where(eq(Links.settlementId, encodeUuid(settlement.id)))
			.orderBy(desc(Entries.created), desc(Entries.id));
	}
	/**
	 * Selects unassigned posted Entries from the settled Account.
	 *
	 * @remarks
	 * Excludes generated offsets on their own settled Account. Generated contra Entries
	 * remain eligible for later Settlements.
	 *
	 * @param db - Repository connection or current transaction.
	 * @param settlement - Scoped Settlement defining eligibility.
	 * @param ids - Explicit selection; omission uses the automatic cutoff.
	 * @returns A query capped at 10,001 rows so callers can detect the 10,000-source limit.
	 */
	private eligible(db: Connection, settlement: LedgerAccountSettlementEntity, ids?: string[]) {
		const d = settlement.data;
		return db
			.select({ id: Entries.id })
			.from(Entries)
			.innerJoin(Transactions, eq(Transactions.id, Entries.transactionId))
			.where(
				and(
					eq(Entries.organizationId, encodeUuid(d.organizationId)),
					eq(Entries.ledgerId, encodeUuid(d.ledgerId)),
					eq(Entries.accountId, encodeUuid(d.settledAccountId)),
					eq(Transactions.status, "posted"),
					ids
						? inArray(Entries.id, ids)
						: d.effectiveAtUpperBound
							? lte(Transactions.effectiveAt, d.effectiveAtUpperBound.toJSDate())
							: undefined,
					sql`NOT EXISTS (SELECT 1 FROM ${Links} WHERE ${Links.entryId} = ${Entries.id})`,
					sql`NOT EXISTS (SELECT 1 FROM ${Settlements} WHERE ${Settlements.id} = ${Transactions.settlementId} AND ${Settlements.settledAccountId} = ${Entries.accountId})`
				)
			)
			.orderBy(desc(Entries.created), desc(Entries.id))
			.limit(10_001);
	}
	/**
	 * Builds accounting from assigned sources and the settled Account normal balance.
	 *
	 * @param db - Repository connection or current transaction.
	 * @param settlement - Settlement supplying the intended target.
	 * @param now - Accounting creation time.
	 * @returns An Effect containing accounting, or an Account/net/persistence failure.
	 */
	private accounting(db: Connection, settlement: LedgerAccountSettlementEntity, now: DateTime) {
		return Effect.gen({ self: this }, function* () {
			const accounts = yield* db
				.select()
				.from(Accounts)
				.where(
					and(
						eq(Accounts.id, encodeUuid(settlement.data.settledAccountId)),
						eq(Accounts.organizationId, encodeUuid(settlement.organizationId)),
						eq(Accounts.ledgerId, encodeUuid(settlement.ledgerId))
					)
				);
			if (!accounts[0]) return yield* Effect.fail(new NotFoundError("Settled Account not found"));
			const sources = yield* this.sources(db, settlement);
			return yield* settlement.toTransaction(
				sources.map(source => source.entry),
				accounts[0].normalBalance,
				settlement.targetStatus === "posted" ? "posted" : "pending",
				now
			);
		});
	}
	/**
	 * Constructs accounting for a prepared Settlement without persisting it.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param now - Accounting creation time.
	 * @returns An Effect containing the generated Transaction, or a validation/persistence failure.
	 */
	buildTransaction(org: OrgID, ledger: LedgerID, id: LedgerAccountSettlementID, now: DateTime) {
		return this.getSettlement(org, ledger, id).pipe(
			Effect.flatMap(settlement => this.accounting(this.db, settlement, now)),
			Effect.mapError(mapError)
		);
	}
	/**
	 * Freezes sources and records an intended transition in the caller’s transaction.
	 *
	 * @remarks
	 * Repeated targets are safe. Voiding a draft releases membership immediately; other
	 * transitions retain membership in processing until accounting is finalized.
	 *
	 * @param db - Current repository transaction.
	 * @param settlement - Locked or newly inserted Settlement.
	 * @param target - Intended accounting status.
	 * @param now - Transition time.
	 * @returns An Effect containing prepared state, or a lifecycle/source/persistence failure.
	 */
	private prepare(
		db: Connection,
		settlement: LedgerAccountSettlementEntity,
		target: SettlementTargetStatus,
		now: DateTime
	): Effect.Effect<LedgerAccountSettlementEntity, HttpError> {
		return Effect.gen({ self: this }, function* () {
			if (settlement.status === target) return settlement;
			if (settlement.status === "processing") {
				if (settlement.targetStatus !== target)
					return yield* Effect.fail(new ConflictError("Settlement is processing another transition"));
				return settlement;
			}
			if (
				settlement.status === "posted" ||
				settlement.status === "voided" ||
				(settlement.status === "pending" && target === "pending")
			)
				return yield* Effect.fail(new ConflictError("Invalid Settlement transition"));
			if (settlement.status === "drafting" && target === "voided") {
				yield* db.delete(Links).where(eq(Links.settlementId, encodeUuid(settlement.id)));
				yield* db
					.update(Settlements)
					.set({ status: "voided", updated: now.toJSDate() })
					.where(scope(settlement.organizationId, settlement.ledgerId, settlement.id));
				return new LedgerAccountSettlementEntity({
					...settlement.data,
					status: "voided",
					updated: now,
				});
			}
			if (settlement.status === "drafting") {
				const existing = yield* this.sources(db, settlement);
				if (settlement.data.effectiveAtUpperBound && existing.length === 0) {
					const selected = yield* this.eligible(db, settlement);
					if (selected.length > 10_000)
						return yield* Effect.fail(new ConflictError("Settlement exceeds 10000 source Entries"));
					if (selected.length > 0)
						yield* db
							.insert(Links)
							.values(
								selected.map(entry => ({ settlementId: encodeUuid(settlement.id), entryId: entry.id }))
							);
				}
				yield* this.accounting(db, settlement, now);
			}
			yield* db
				.update(Settlements)
				.set({ status: "processing", targetStatus: target, updated: now.toJSDate() })
				.where(scope(settlement.organizationId, settlement.ledgerId, settlement.id));
			return new LedgerAccountSettlementEntity({
				...settlement.data,
				status: "processing",
				targetStatus: target,
				updated: now,
			});
		}).pipe(Effect.mapError(mapError));
	}
	/**
	 * Creates a Settlement and optionally prepares accounting in one database transaction.
	 *
	 * @param entity - Draft to persist.
	 * @param target - Initial accounting target; undefined retains drafting.
	 * @param now - Preparation time.
	 * @returns An Effect containing persisted state, or an Account/source/persistence failure.
	 */
	createSettlement(
		entity: LedgerAccountSettlementEntity,
		target: "pending" | "posted" | undefined,
		now: DateTime
	) {
		return this.db
			.transaction(db =>
				Effect.gen({ self: this }, function* () {
					const accounts = yield* db
						.select()
						.from(Accounts)
						.where(
							and(
								eq(Accounts.organizationId, encodeUuid(entity.organizationId)),
								eq(Accounts.ledgerId, encodeUuid(entity.ledgerId)),
								inArray(Accounts.id, [
									encodeUuid(entity.data.settledAccountId),
									encodeUuid(entity.data.contraAccountId),
								])
							)
						);
					if (accounts.length !== 2)
						return yield* Effect.fail(
							new ConflictError("Settlement requires two distinct Accounts in its Ledger")
						);
					if (accounts.some(account => account.currencyCode !== entity.data.currency))
						return yield* Effect.fail(
							new ConflictError("Settlement Accounts must use the same Currency")
						);
					yield* db.insert(Settlements).values(entity.toRow());
					return target ? yield* this.prepare(db, entity, target, now) : entity;
				})
			)
			.pipe(Effect.mapError(mapError));
	}
	/**
	 * Applies edits and prepares the requested transition under a Settlement row lock.
	 *
	 * @remarks
	 * Omitted metadata is preserved; supplied metadata replaces it. A retry of the
	 * current processing target returns frozen state without applying new edits.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param patch - Supplied edits and optional target status.
	 * @param now - Edit and preparation time.
	 * @returns An Effect containing prepared state, or a lifecycle/persistence failure.
	 */
	prepareSettlement(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		patch: LedgerAccountSettlementPatchRequest,
		now: DateTime
	) {
		return this.db
			.transaction(db =>
				Effect.gen({ self: this }, function* () {
					const settlement = yield* this.read(db, org, ledger, id, true);
					if (settlement.status === "processing") {
						if (patch.status !== settlement.targetStatus)
							return yield* Effect.fail(new ConflictError("Settlement is processing another transition"));
						return settlement;
					}
					if (
						(settlement.status === "posted" || settlement.status === "voided") &&
						patch.description !== undefined
					)
						return yield* Effect.fail(
							new ConflictError("Terminal Settlements permit metadata edits only")
						);
					const edited = new LedgerAccountSettlementEntity({
						...settlement.data,
						description: patch.description ?? settlement.data.description,
						metadata: patch.metadata ?? settlement.data.metadata,
						updated: now,
					});
					yield* db
						.update(Settlements)
						.set({
							description: edited.data.description,
							metadata: encodeMetadata(edited.data.metadata),
							updated: now.toJSDate(),
						})
						.where(scope(org, ledger, id));
					return patch.status ? yield* this.prepare(db, edited, patch.status, now) : edited;
				})
			)
			.pipe(Effect.mapError(mapError));
	}
	/**
	 * Commits a prepared target after its accounting reaches the same status.
	 *
	 * @remarks
	 * Owns a separate database transaction. Voiding releases source membership; successful
	 * finalization clears the processing target. Repeating a completed target is safe.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param target - Expected processing target.
	 * @param now - Finalization time.
	 * @returns An Effect containing finalized state, or an accounting-state/persistence failure.
	 */
	finalizeSettlement(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		target: SettlementTargetStatus,
		now: DateTime
	) {
		return this.db
			.transaction(db =>
				Effect.gen({ self: this }, function* () {
					const settlement = yield* this.read(db, org, ledger, id, true);
					if (settlement.status === target) return settlement;
					if (
						settlement.status !== "processing" ||
						settlement.targetStatus !== target ||
						settlement.transaction?.status !== target
					)
						return yield* Effect.fail(
							new ConflictError("Settlement accounting has not completed the intended transition")
						);
					if (target === "voided") yield* db.delete(Links).where(eq(Links.settlementId, encodeUuid(id)));
					yield* db
						.update(Settlements)
						// oxlint-disable-next-line unicorn/no-null -- Clear the persisted processing target.
						.set({ status: target, targetStatus: null, updated: now.toJSDate() })
						.where(scope(org, ledger, id));
					return new LedgerAccountSettlementEntity({
						...settlement.data,
						status: target,
						targetStatus: undefined,
						updated: now,
					});
				})
			)
			.pipe(Effect.mapError(mapError));
	}
	/**
	 * Changes manual draft membership in one database transaction.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param entryIds - One to 500 source Entry identifiers.
	 * @param add - True to add eligible sources; false to remove membership.
	 * @returns An Effect completing the edit, or a membership/lifecycle/persistence failure.
	 */
	changeEntries(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		entryIds: string[],
		add: boolean
	) {
		return this.db
			.transaction(db =>
				Effect.gen({ self: this }, function* () {
					if (entryIds.length < 1 || entryIds.length > 500)
						return yield* Effect.fail(new BadRequestError("Specify between 1 and 500 Entries"));
					const settlement = yield* this.read(db, org, ledger, id, true);
					if (settlement.status !== "drafting")
						return yield* Effect.fail(
							new ConflictError("Only drafting Settlement membership can change")
						);
					if (add) {
						const selected = yield* this.eligible(
							db,
							settlement,
							entryIds.map(id => encodeUuid(TypeID.fromString(id, "lte")))
						);
						if (selected.length !== entryIds.length)
							return yield* Effect.fail(new ConflictError("Entries must be eligible and unassigned"));
						const existing = yield* this.sources(db, settlement);
						if (existing.length + selected.length > 10_000)
							return yield* Effect.fail(new ConflictError("Settlement exceeds 10000 source Entries"));
						yield* db
							.insert(Links)
							.values(selected.map(entry => ({ settlementId: encodeUuid(id), entryId: entry.id })));
					} else
						yield* db.delete(Links).where(
							and(
								eq(Links.settlementId, encodeUuid(id)),
								inArray(
									Links.entryId,
									entryIds.map(id => encodeUuid(TypeID.fromString(id, "lte")))
								)
							)
						);
				})
			)
			.pipe(Effect.mapError(mapError));
	}
	/**
	 * Lists a scoped Settlement’s sources in descending creation and ID order.
	 *
	 * @param org - Owning Organization.
	 * @param ledger - Containing Ledger.
	 * @param id - Settlement identifier.
	 * @param offset - Rows to skip.
	 * @param limit - Maximum rows to return.
	 * @returns An Effect containing source responses, or a missing-row/persistence failure.
	 */
	listEntries(
		org: OrgID,
		ledger: LedgerID,
		id: LedgerAccountSettlementID,
		offset: number,
		limit: number
	): Effect.Effect<LedgerAccountSettlementEntryResponse[], HttpError> {
		return Effect.gen({ self: this }, function* () {
			const settlement = yield* this.getSettlement(org, ledger, id);
			const rows = yield* this.sources(this.db, settlement).offset(offset).limit(limit);
			return yield* Effect.forEach(rows, row =>
				parseMetadata(row.entry.metadata).pipe(
					Effect.map(metadata => ({
						id: TypeID.fromUUID("lte", row.entry.id).toString(),
						transactionId: TypeID.fromUUID("ltr", row.entry.transactionId).toString(),
						accountId: TypeID.fromUUID("lat", row.entry.accountId).toString(),
						effectiveAt: row.effectiveAt.toISOString(),
						direction: row.entry.direction,
						amount: row.entry.amount,
						currencyCode: row.entry.currency,
						status: "posted" as const,
						metadata,
						created: row.entry.created.toISOString(),
					}))
				)
			);
		}).pipe(Effect.mapError(mapError));
	}
}
/** Public Settlement persistence operations, excluding connection-level helpers. */
type LedgerAccountSettlementRepo = Pick<
	LedgerAccountSettlementRepoLive,
	| "getSettlement"
	| "listSettlements"
	| "createSettlement"
	| "prepareSettlement"
	| "finalizeSettlement"
	| "buildTransaction"
	| "changeEntries"
	| "listEntries"
>;
/** Effect service key for Settlement persistence. */
const LedgerAccountSettlementRepoTag = Context.Service<LedgerAccountSettlementRepo>(
	"LedgerAccountSettlementRepo"
);
/** Constructs Settlement persistence from the application database. */
const ledgerAccountSettlementRepoLayer = Layer.effect(
	LedgerAccountSettlementRepoTag,
	DatabaseTag.pipe(Effect.map(database => new LedgerAccountSettlementRepoLive(database.effectDb)))
);
export {
	LedgerAccountSettlementRepoLive,
	LedgerAccountSettlementRepoTag,
	ledgerAccountSettlementRepoLayer,
};
export type { LedgerAccountSettlementRepo };
