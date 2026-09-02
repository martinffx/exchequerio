import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";

import { DatabaseTag, type EffectDrizzleDatabase, postgresErrorCode } from "@/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type {
	LedgerAccountSettlementID,
	LedgerID,
	LedgerTransactionID,
	OrgID,
} from "@/repo/entities/types";
import {
	LedgerAccountSettlementEntriesTable,
	LedgerAccountSettlementsTable,
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "@/repo/schema";

import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import { LedgerAccountSettlementPersistenceDecodingFailure } from "./LedgerAccountSettlementErrors";
import type { SettlementStatus } from "./LedgerAccountSettlementSchema";

type LedgerAccountSettlementListRepositoryError =
	| EffectDrizzleQueryError
	| LedgerAccountSettlementPersistenceDecodingFailure;
type LedgerAccountSettlementGetRepositoryError =
	| EffectDrizzleQueryError
	| LedgerAccountSettlementPersistenceDecodingFailure
	| NotFoundError;
type LedgerAccountSettlementCreateRepositoryError =
	| ConflictError
	| EffectDrizzleQueryError
	| LedgerAccountSettlementPersistenceDecodingFailure
	| NotFoundError;
type LedgerAccountSettlementUpdateRepositoryError =
	| ConflictError
	| EffectDrizzleQueryError
	| LedgerAccountSettlementPersistenceDecodingFailure;
type LedgerAccountSettlementDeleteRepositoryError = ConflictError | EffectDrizzleQueryError;
type LedgerAccountSettlementEntryRepositoryError =
	| ConflictError
	| EffectDrizzleQueryError
	| LedgerAccountSettlementPersistenceDecodingFailure
	| NotFoundError;
type LedgerAccountSettlementReadRepositoryError = EffectDrizzleQueryError;
type LedgerAccountSettlementStatusRepositoryError =
	| EffectDrizzleQueryError
	| LedgerAccountSettlementPersistenceDecodingFailure
	| NotFoundError;

interface LedgerAccountSettlementRepo {
	listSettlements(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Effect.Effect<LedgerAccountSettlementEntity[], LedgerAccountSettlementListRepositoryError>;
	getSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementGetRepositoryError>;
	createSettlement(
		entity: LedgerAccountSettlementEntity
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementCreateRepositoryError>;
	updateSettlement(
		entity: LedgerAccountSettlementEntity
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementUpdateRepositoryError>;
	updateAmount(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		amount: number
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementUpdateRepositoryError>;
	linkTransaction(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		transactionId: LedgerTransactionID
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementUpdateRepositoryError>;
	deleteSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<void, LedgerAccountSettlementDeleteRepositoryError>;
	addEntriesToSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryRepositoryError>;
	removeEntriesFromSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryRepositoryError>;
	getEntryIds(
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<string[], LedgerAccountSettlementReadRepositoryError>;
	calculateAmount(
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<number, LedgerAccountSettlementReadRepositoryError>;
	updateStatus(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		status: SettlementStatus
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementStatusRepositoryError>;
}

const LedgerAccountSettlementRepoTag = Context.Service<LedgerAccountSettlementRepo>(
	"LedgerAccountSettlementRepo"
);

class LedgerAccountSettlementRepoLive implements LedgerAccountSettlementRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}

	listSettlements(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Effect.Effect<LedgerAccountSettlementEntity[], LedgerAccountSettlementListRepositoryError> {
		return this.db
			.select(getTableColumns(LedgerAccountSettlementsTable))
			.from(LedgerAccountSettlementsTable)
			.innerJoin(
				LedgerAccountsTable,
				eq(LedgerAccountSettlementsTable.settledAccountId, LedgerAccountsTable.id)
			)
			.where(
				and(
					eq(LedgerAccountSettlementsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			)
			.orderBy(desc(LedgerAccountSettlementsTable.created))
			.limit(limit)
			.offset(offset)
			.pipe(
				Effect.flatMap(rows => Effect.all(rows.map(row => LedgerAccountSettlementEntity.fromRow(row))))
			);
	}

	getSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementGetRepositoryError> {
		return this.db
			.select(getTableColumns(LedgerAccountSettlementsTable))
			.from(LedgerAccountSettlementsTable)
			.where(
				and(
					eq(LedgerAccountSettlementsTable.id, settlementId.toString()),
					eq(LedgerAccountSettlementsTable.organizationId, organizationId.toString())
				)
			)
			.limit(1)
			.pipe(
				Effect.flatMap(rows =>
					Effect.gen(function* () {
						const row = rows[0];
						if (row === undefined) {
							return yield* Effect.fail(
								new NotFoundError(`Settlement not found: ${settlementId.toString()}`)
							);
						}
						return yield* LedgerAccountSettlementEntity.fromRow(row);
					})
				)
			);
	}

	createSettlement(
		entity: LedgerAccountSettlementEntity
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementCreateRepositoryError> {
		return this.db
			.insert(LedgerAccountSettlementsTable)
			.values(entity.toRow())
			.returning()
			.pipe(
				Effect.flatMap(rows => LedgerAccountSettlementEntity.fromRow(rows[0])),
				Effect.mapError(error => {
					const code = postgresErrorCode(error);
					if (code === "23503") {
						return new NotFoundError("Referenced account or organization not found");
					}
					return code === "23514" ? new ConflictError("Cannot settle an account to itself") : error;
				})
			);
	}

	updateSettlement(
		entity: LedgerAccountSettlementEntity
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementUpdateRepositoryError> {
		return Effect.suspend(() =>
			this.db
				.update(LedgerAccountSettlementsTable)
				.set({ ...entity.toRow(), updated: new Date() })
				.where(
					and(
						eq(LedgerAccountSettlementsTable.id, entity.id.toString()),
						eq(LedgerAccountSettlementsTable.organizationId, entity.organizationId.toString()),
						eq(LedgerAccountSettlementsTable.status, "drafting")
					)
				)
				.returning()
				.pipe(
					Effect.flatMap(rows =>
						Effect.gen(function* () {
							const row = rows[0];
							if (row === undefined) {
								return yield* Effect.fail(
									new ConflictError("Settlement not found or not in drafting status")
								);
							}
							return yield* LedgerAccountSettlementEntity.fromRow(row);
						})
					)
				)
		);
	}

	updateAmount(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		amount: number
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementUpdateRepositoryError> {
		return Effect.suspend(() =>
			this.db
				.update(LedgerAccountSettlementsTable)
				.set({ amount, updated: new Date() })
				.where(
					and(
						eq(LedgerAccountSettlementsTable.id, settlementId.toString()),
						eq(LedgerAccountSettlementsTable.organizationId, organizationId.toString())
					)
				)
				.returning()
				.pipe(
					Effect.flatMap(rows =>
						Effect.gen(function* () {
							const row = rows[0];
							if (row === undefined) {
								return yield* Effect.fail(new ConflictError("Settlement not found"));
							}
							return yield* LedgerAccountSettlementEntity.fromRow(row);
						})
					)
				)
		);
	}

	linkTransaction(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		transactionId: LedgerTransactionID
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementUpdateRepositoryError> {
		return Effect.suspend(() =>
			this.db
				.update(LedgerAccountSettlementsTable)
				.set({ transactionId: transactionId.toString(), updated: new Date() })
				.where(
					and(
						eq(LedgerAccountSettlementsTable.id, settlementId.toString()),
						eq(LedgerAccountSettlementsTable.organizationId, organizationId.toString())
					)
				)
				.returning()
				.pipe(
					Effect.flatMap(rows =>
						Effect.gen(function* () {
							const row = rows[0];
							if (row === undefined) {
								return yield* Effect.fail(new ConflictError("Settlement not found"));
							}
							return yield* LedgerAccountSettlementEntity.fromRow(row);
						})
					)
				)
		);
	}

	deleteSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<void, LedgerAccountSettlementDeleteRepositoryError> {
		return this.db
			.delete(LedgerAccountSettlementsTable)
			.where(
				and(
					eq(LedgerAccountSettlementsTable.id, settlementId.toString()),
					eq(LedgerAccountSettlementsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountSettlementsTable.status, "drafting")
				)
			)
			.returning({ id: LedgerAccountSettlementsTable.id })
			.pipe(
				Effect.flatMap(rows =>
					rows.length === 0
						? Effect.fail(new ConflictError("Settlement not found or not in drafting status"))
						: Effect.void
				)
			);
	}

	addEntriesToSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryRepositoryError> {
		return Effect.gen({ self: this }, function* () {
			const settlement = yield* this.getSettlement(organizationId, settlementId);
			if (settlement.status !== "drafting") {
				return yield* Effect.fail(
					new ConflictError("Can only add entries to settlements in drafting status")
				);
			}

			yield* Effect.forEach(
				entryIds,
				entryId =>
					Effect.gen({ self: this }, function* () {
						const entry = yield* this.db
							.select({
								id: LedgerTransactionEntriesTable.id,
								accountId: LedgerTransactionEntriesTable.accountId,
								status: LedgerTransactionsTable.status,
							})
							.from(LedgerTransactionEntriesTable)
							.innerJoin(
								LedgerTransactionsTable,
								and(
									eq(LedgerTransactionsTable.id, LedgerTransactionEntriesTable.transactionId),
									eq(LedgerTransactionsTable.organizationId, LedgerTransactionEntriesTable.organizationId),
									eq(LedgerTransactionsTable.ledgerId, LedgerTransactionEntriesTable.ledgerId)
								)
							)
							.where(
								and(
									eq(LedgerTransactionEntriesTable.id, entryId),
									eq(LedgerTransactionEntriesTable.organizationId, organizationId.toString())
								)
							)
							.limit(1)
							.pipe(Effect.map(rows => rows[0]));
						if (entry === undefined) {
							return yield* Effect.fail(new NotFoundError(`Entry not found: ${entryId}`));
						}
						if (entry.accountId !== settlement.settledAccountId.toString()) {
							return yield* Effect.fail(
								new ConflictError(`Entry ${entryId} does not belong to the settled account`)
							);
						}
						if (entry.status !== "posted") {
							return yield* Effect.fail(
								new ConflictError(
									`Transaction for entry ${entryId} is not posted (status: ${entry.status})`
								)
							);
						}
						const attached = yield* this.db
							.select({ settlementId: LedgerAccountSettlementEntriesTable.settlementId })
							.from(LedgerAccountSettlementEntriesTable)
							.where(eq(LedgerAccountSettlementEntriesTable.entryId, entryId))
							.limit(1);
						if (attached[0] !== undefined) {
							return yield* Effect.fail(
								new ConflictError(
									`Entry ${entryId} is already attached to settlement ${attached[0].settlementId}`
								)
							);
						}
					}),
				{ concurrency: 1, discard: true }
			);

			yield* this.db
				.insert(LedgerAccountSettlementEntriesTable)
				.values(entryIds.map(entryId => ({ settlementId: settlementId.toString(), entryId })))
				.onConflictDoNothing();
		});
	}

	removeEntriesFromSettlement(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Effect.Effect<void, LedgerAccountSettlementEntryRepositoryError> {
		return Effect.gen({ self: this }, function* () {
			const settlement = yield* this.getSettlement(organizationId, settlementId);
			if (settlement.status !== "drafting") {
				return yield* Effect.fail(
					new ConflictError("Can only remove entries from settlements in drafting status")
				);
			}
			yield* this.db
				.delete(LedgerAccountSettlementEntriesTable)
				.where(
					and(
						eq(LedgerAccountSettlementEntriesTable.settlementId, settlementId.toString()),
						inArray(LedgerAccountSettlementEntriesTable.entryId, entryIds)
					)
				);
		});
	}

	getEntryIds(
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<string[], LedgerAccountSettlementReadRepositoryError> {
		return this.db
			.select({ entryId: LedgerAccountSettlementEntriesTable.entryId })
			.from(LedgerAccountSettlementEntriesTable)
			.where(eq(LedgerAccountSettlementEntriesTable.settlementId, settlementId.toString()))
			.pipe(Effect.map(rows => rows.map(row => row.entryId)));
	}

	calculateAmount(
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<number, LedgerAccountSettlementReadRepositoryError> {
		return this.db
			.select({ total: sql<string>`COALESCE(SUM(${LedgerTransactionEntriesTable.amount}), 0)` })
			.from(LedgerAccountSettlementEntriesTable)
			.innerJoin(
				LedgerTransactionEntriesTable,
				eq(LedgerAccountSettlementEntriesTable.entryId, LedgerTransactionEntriesTable.id)
			)
			.where(eq(LedgerAccountSettlementEntriesTable.settlementId, settlementId.toString()))
			.pipe(Effect.map(rows => Number.parseInt(rows[0]?.total ?? "0", 10)));
	}

	updateStatus(
		organizationId: OrgID,
		settlementId: LedgerAccountSettlementID,
		status: SettlementStatus
	): Effect.Effect<LedgerAccountSettlementEntity, LedgerAccountSettlementStatusRepositoryError> {
		return Effect.suspend(() =>
			this.db
				.update(LedgerAccountSettlementsTable)
				.set({ status, updated: new Date() })
				.where(
					and(
						eq(LedgerAccountSettlementsTable.id, settlementId.toString()),
						eq(LedgerAccountSettlementsTable.organizationId, organizationId.toString())
					)
				)
				.returning()
				.pipe(
					Effect.flatMap(rows =>
						Effect.gen(function* () {
							const row = rows[0];
							if (row === undefined) {
								return yield* Effect.fail(
									new NotFoundError(`Settlement not found: ${settlementId.toString()}`)
								);
							}
							return yield* LedgerAccountSettlementEntity.fromRow(row);
						})
					)
				)
		);
	}
}

const ledgerAccountSettlementRepoLayer = Layer.effect(
	LedgerAccountSettlementRepoTag,
	DatabaseTag.pipe(Effect.map(database => new LedgerAccountSettlementRepoLive(database.effectDb)))
);

export type {
	LedgerAccountSettlementCreateRepositoryError,
	LedgerAccountSettlementDeleteRepositoryError,
	LedgerAccountSettlementEntryRepositoryError,
	LedgerAccountSettlementGetRepositoryError,
	LedgerAccountSettlementListRepositoryError,
	LedgerAccountSettlementReadRepositoryError,
	LedgerAccountSettlementRepo,
	LedgerAccountSettlementStatusRepositoryError,
	LedgerAccountSettlementUpdateRepositoryError,
};
export {
	LedgerAccountSettlementRepoLive,
	LedgerAccountSettlementRepoTag,
	ledgerAccountSettlementRepoLayer,
};
