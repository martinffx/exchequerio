import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";
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
import { encodeMetadata, parseMetadata } from "@/lib/utils";
import type { LedgerAccountSettlementID, LedgerID, OrgID } from "@/repo/entities/types";
import {
	LedgerAccountSettlementEntriesTable as Links,
	LedgerAccountSettlementsTable as Settlements,
	LedgerAccountsTable as Accounts,
	LedgerTransactionEntriesTable as Entries,
	LedgerTransactionsTable as Transactions,
} from "@/repo/schema";
import { LedgerTransaction } from "../transactions/LedgerTransaction";
import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import type {
	LedgerAccountSettlementEntryResponse,
	LedgerAccountSettlementPatchRequest,
	SettlementTargetStatus,
} from "./LedgerAccountSettlementSchema";

type Connection = Pick<EffectDrizzleDatabase, "select" | "insert" | "update" | "delete" | "query">;
const scope = (organizationId: OrgID, ledgerId: LedgerID, id: LedgerAccountSettlementID) =>
	and(
		eq(Settlements.organizationId, organizationId.toString()),
		eq(Settlements.ledgerId, ledgerId.toString()),
		eq(Settlements.id, id.toString())
	);
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
class LedgerAccountSettlementRepoLive {
	constructor(private readonly db: EffectDrizzleDatabase) {}
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
					organizationId: organizationId.toString(),
					ledgerId: ledgerId.toString(),
					settlementId: id.toString(),
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
	getSettlement(organizationId: OrgID, ledgerId: LedgerID, id: LedgerAccountSettlementID) {
		return this.read(this.db, organizationId, ledgerId, id);
	}
	listSettlements(organizationId: OrgID, ledgerId: LedgerID, offset: number, limit: number) {
		return this.db.query.LedgerAccountSettlementsTable.findMany({
			where: { organizationId: organizationId.toString(), ledgerId: ledgerId.toString() },
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
	private sources(db: Connection, settlement: LedgerAccountSettlementEntity) {
		return db
			.select({ entry: Entries, effectiveAt: Transactions.effectiveAt })
			.from(Links)
			.innerJoin(Entries, eq(Entries.id, Links.entryId))
			.innerJoin(Transactions, eq(Transactions.id, Entries.transactionId))
			.where(eq(Links.settlementId, settlement.id.toString()))
			.orderBy(desc(Entries.created), desc(Entries.id));
	}
	private eligible(db: Connection, settlement: LedgerAccountSettlementEntity, ids?: string[]) {
		const d = settlement.data;
		return db
			.select({ id: Entries.id })
			.from(Entries)
			.innerJoin(Transactions, eq(Transactions.id, Entries.transactionId))
			.where(
				and(
					eq(Entries.organizationId, d.organizationId.toString()),
					eq(Entries.ledgerId, d.ledgerId.toString()),
					eq(Entries.accountId, d.settledAccountId.toString()),
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
	private accounting(db: Connection, settlement: LedgerAccountSettlementEntity, now: DateTime) {
		return Effect.gen({ self: this }, function* () {
			const accounts = yield* db
				.select()
				.from(Accounts)
				.where(
					and(
						eq(Accounts.id, settlement.data.settledAccountId.toString()),
						eq(Accounts.organizationId, settlement.organizationId.toString()),
						eq(Accounts.ledgerId, settlement.ledgerId.toString())
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
	buildTransaction(org: OrgID, ledger: LedgerID, id: LedgerAccountSettlementID, now: DateTime) {
		return this.getSettlement(org, ledger, id).pipe(
			Effect.flatMap(settlement => this.accounting(this.db, settlement, now)),
			Effect.mapError(mapError)
		);
	}
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
				yield* db.delete(Links).where(eq(Links.settlementId, settlement.id.toString()));
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
								selected.map(entry => ({ settlementId: settlement.id.toString(), entryId: entry.id }))
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
								eq(Accounts.organizationId, entity.organizationId.toString()),
								eq(Accounts.ledgerId, entity.ledgerId.toString()),
								inArray(Accounts.id, [
									entity.data.settledAccountId.toString(),
									entity.data.contraAccountId.toString(),
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
					if (target === "voided") yield* db.delete(Links).where(eq(Links.settlementId, id.toString()));
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
						const selected = yield* this.eligible(db, settlement, entryIds);
						if (selected.length !== entryIds.length)
							return yield* Effect.fail(new ConflictError("Entries must be eligible and unassigned"));
						const existing = yield* this.sources(db, settlement);
						if (existing.length + selected.length > 10_000)
							return yield* Effect.fail(new ConflictError("Settlement exceeds 10000 source Entries"));
						yield* db
							.insert(Links)
							.values(selected.map(entry => ({ settlementId: id.toString(), entryId: entry.id })));
					} else
						yield* db
							.delete(Links)
							.where(and(eq(Links.settlementId, id.toString()), inArray(Links.entryId, entryIds)));
				})
			)
			.pipe(Effect.mapError(mapError));
	}
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
						id: row.entry.id,
						transactionId: row.entry.transactionId,
						accountId: row.entry.accountId,
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
const LedgerAccountSettlementRepoTag = Context.Service<LedgerAccountSettlementRepo>(
	"LedgerAccountSettlementRepo"
);
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
