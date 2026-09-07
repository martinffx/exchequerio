import { encodeUuid } from "@/lib/utils";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type DrizzleDatabase } from "@/db";
import { OrganizationNotFound } from "@/domains/organizations";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import {
	LedgersTable,
	LedgerAccountsTable,
	LedgerAccountSettlementsTable,
	LedgerAccountSettlementEntriesTable,
	LedgerTransactionsTable,
	LedgerTransactionEntriesTable,
} from "@/repo/schema";
import { Ledger } from "./Ledger";
import {
	LedgerHasDependents,
	type LedgerInfrastructureError as LedgerInfrastructureErrorType,
	mapLedgerCreateError,
	mapLedgerDeleteError,
	mapLedgerInfrastructureError,
	requireCreatedLedger,
} from "./LedgerErrors";

type LedgerInfrastructureError = LedgerInfrastructureErrorType;

type LedgerListQuery = {
	readonly offset: number;
	readonly limit: number;
};

/**
 * Persists Ledgers within their owning Organizations.
 *
 * Expected failures are returned through each operation's Effect error channel.
 */
interface LedgerRepo {
	/**
	 * Lists Ledgers for one Organization.
	 *
	 * @param organizationId - Organization that owns the Ledgers.
	 * @param query - Pagination parameters for the result set.
	 * @returns An Effect containing the requested page of Ledgers.
	 */
	listLedgers(
		organizationId: OrgID,
		query: LedgerListQuery
	): Effect.Effect<Ledger[], LedgerInfrastructureError>;
	/**
	 * Finds a Ledger within one Organization.
	 *
	 * @param organizationId - Organization that owns the Ledger.
	 * @param ledgerId - Ledger to find.
	 * @returns An Effect containing the Ledger when found, or `Option.none()` otherwise.
	 */
	getLedger(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError>;
	/**
	 * Creates a Ledger from a validated domain record.
	 *
	 * @param record - Ledger to persist.
	 * @returns An Effect containing the created Ledger.
	 */
	createLedger(record: Ledger): Effect.Effect<Ledger, LedgerCreateRepositoryError>;
	/**
	 * Updates the mutable fields of an existing Ledger.
	 *
	 * @param record - Ledger state to persist.
	 * @returns An Effect containing the updated Ledger, or `Option.none()` when absent.
	 */
	updateLedger(record: Ledger): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError>;
	/**
	 * Deletes a Ledger within one Organization.
	 *
	 * @param organizationId - Organization that owns the Ledger.
	 * @param ledgerId - Ledger to delete.
	 * @returns An Effect containing the deleted Ledger, or `Option.none()` when absent.
	 */
	deleteLedger(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<Ledger>, LedgerDeleteRepositoryError>;
	/**
	 * Deletes a scoped test Ledger and all its accounting fixtures atomically.
	 *
	 * @remarks
	 * Repository-only fixture cleanup; ordinary Ledger deletion still rejects dependents.
	 * Locks the Ledger and deletes dependents in foreign-key order within one transaction.
	 *
	 * @param organizationId - Organization owning the fixture.
	 * @param ledgerId - Fixture Ledger to delete.
	 * @returns An Effect completing cleanup, including when absent, or a persistence failure.
	 */
	deleteLedgerFixtures(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<void, LedgerDeleteRepositoryError>;
}

type LedgerCreateRepositoryError = LedgerInfrastructureError | OrganizationNotFound;
type LedgerDeleteRepositoryError = LedgerInfrastructureError | LedgerHasDependents;

const LedgerRepoTag = Context.Service<LedgerRepo>("LedgerRepo");

const publicColumns = {
	id: LedgersTable.id,
	organizationId: LedgersTable.organizationId,
	name: LedgersTable.name,
	description: LedgersTable.description,
	metadata: LedgersTable.metadata,
	created: LedgersTable.created,
	updated: LedgersTable.updated,
};

/** PostgreSQL implementation of the Ledger repository contract. */
class LedgerRepoLive implements LedgerRepo {
	/**
	 * Creates a Ledger repository backed by Drizzle.
	 *
	 * @param db - Database used for all Ledger reads and writes.
	 */
	constructor(private readonly db: DrizzleDatabase) {}

	/**
	 * Lists tenant-scoped Ledgers in ascending identifier order.
	 *
	 * @param organizationId - Organization that owns the Ledgers.
	 * @param query - Offset and limit for the result page.
	 * @returns An Effect containing decoded Ledgers in stable order.
	 */
	listLedgers(
		organizationId: OrgID,
		{ limit, offset }: LedgerListQuery
	): Effect.Effect<Ledger[], LedgerInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(publicColumns)
					.from(LedgersTable)
					.where(eq(LedgersTable.organizationId, encodeUuid(organizationId)))
					.orderBy(asc(LedgersTable.id))
					.limit(limit)
					.offset(offset),
			catch: mapLedgerInfrastructureError,
		}).pipe(
			Effect.flatMap(rows => Effect.all(rows.map(row => Ledger.fromRow(row)))),
			Effect.map(ledgers => ledgers.flatMap(ledger => Option.toArray(ledger)))
		);
	}

	/**
	 * Reads one tenant-scoped Ledger.
	 *
	 * @param organizationId - Organization that owns the Ledger.
	 * @param ledgerId - Ledger to read.
	 * @returns An Effect containing the decoded Ledger, or `Option.none()` when absent.
	 */
	getLedger(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(publicColumns)
					.from(LedgersTable)
					.where(
						and(
							eq(LedgersTable.id, encodeUuid(ledgerId)),
							eq(LedgersTable.organizationId, encodeUuid(organizationId))
						)
					)
					.limit(1),
			catch: mapLedgerInfrastructureError,
		}).pipe(Effect.flatMap(rows => Ledger.fromRow(rows[0])));
	}

	/**
	 * Inserts a Ledger and maps a missing parent Organization to a typed failure.
	 *
	 * @param record - Ledger to insert.
	 * @returns An Effect containing the inserted Ledger.
	 */
	createLedger(record: Ledger): Effect.Effect<Ledger, LedgerCreateRepositoryError> {
		return Effect.tryPromise({
			try: () => this.db.insert(LedgersTable).values(record.toCreateRow()).returning(publicColumns),
			catch: mapLedgerCreateError,
		}).pipe(
			Effect.flatMap(rows => Ledger.fromRow(rows[0])),
			Effect.flatMap(requireCreatedLedger)
		);
	}

	/**
	 * Updates a Ledger only when its identifier and Organization both match.
	 *
	 * @param record - Ledger state whose mutable fields will be persisted.
	 * @returns An Effect containing the updated Ledger, or `Option.none()` when no row matches.
	 */
	updateLedger(record: Ledger): Effect.Effect<Option.Option<Ledger>, LedgerInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.update(LedgersTable)
					.set(record.toUpdateRow())
					.where(
						and(
							eq(LedgersTable.id, encodeUuid(record.id)),
							eq(LedgersTable.organizationId, encodeUuid(record.organizationId))
						)
					)
					.returning(publicColumns),
			catch: mapLedgerInfrastructureError,
		}).pipe(Effect.flatMap(rows => Ledger.fromRow(rows[0])));
	}

	/**
	 * Deletes a tenant-scoped Ledger and rejects Ledgers with dependent records.
	 *
	 * @param organizationId - Organization that owns the Ledger.
	 * @param ledgerId - Ledger to delete.
	 * @returns An Effect containing the deleted Ledger, or `Option.none()` when no row matches.
	 */
	deleteLedger(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<Option.Option<Ledger>, LedgerDeleteRepositoryError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.delete(LedgersTable)
					.where(
						and(
							eq(LedgersTable.id, encodeUuid(ledgerId)),
							eq(LedgersTable.organizationId, encodeUuid(organizationId))
						)
					)
					.returning(publicColumns),
			catch: mapLedgerDeleteError,
		}).pipe(Effect.flatMap(rows => Ledger.fromRow(rows[0])));
	}
	/**
	 * Deletes a scoped test Ledger and all its accounting fixtures atomically.
	 *
	 * @remarks
	 * Repository-only fixture cleanup; ordinary Ledger deletion still rejects dependents.
	 * Locks the Ledger and deletes dependents in foreign-key order within one transaction.
	 *
	 * @param organizationId - Organization owning the fixture.
	 * @param ledgerId - Fixture Ledger to delete.
	 * @returns An Effect completing cleanup, including when absent, or a persistence failure.
	 */
	deleteLedgerFixtures(
		organizationId: OrgID,
		ledgerId: LedgerID
	): Effect.Effect<void, LedgerDeleteRepositoryError> {
		return Effect.tryPromise({
			try: () =>
				this.db.transaction(async tx => {
					const ledger = await tx
						.select({ id: LedgersTable.id })
						.from(LedgersTable)
						.where(
							and(
								eq(LedgersTable.organizationId, encodeUuid(organizationId)),
								eq(LedgersTable.id, encodeUuid(ledgerId))
							)
						)
						.for("update");
					if (ledger.length === 0) return;
					const settlements = tx
						.select({ id: LedgerAccountSettlementsTable.id })
						.from(LedgerAccountSettlementsTable)
						.where(
							and(
								eq(LedgerAccountSettlementsTable.organizationId, encodeUuid(organizationId)),
								eq(LedgerAccountSettlementsTable.ledgerId, encodeUuid(ledgerId))
							)
						);
					await tx
						.delete(LedgerAccountSettlementEntriesTable)
						.where(inArray(LedgerAccountSettlementEntriesTable.settlementId, settlements));
					await tx
						.delete(LedgerTransactionEntriesTable)
						.where(
							and(
								eq(LedgerTransactionEntriesTable.organizationId, encodeUuid(organizationId)),
								eq(LedgerTransactionEntriesTable.ledgerId, encodeUuid(ledgerId))
							)
						);
					await tx
						.delete(LedgerTransactionsTable)
						.where(
							and(
								eq(LedgerTransactionsTable.organizationId, encodeUuid(organizationId)),
								eq(LedgerTransactionsTable.ledgerId, encodeUuid(ledgerId))
							)
						);
					await tx
						.delete(LedgerAccountSettlementsTable)
						.where(
							and(
								eq(LedgerAccountSettlementsTable.organizationId, encodeUuid(organizationId)),
								eq(LedgerAccountSettlementsTable.ledgerId, encodeUuid(ledgerId))
							)
						);
					await tx
						.delete(LedgerAccountsTable)
						.where(
							and(
								eq(LedgerAccountsTable.organizationId, encodeUuid(organizationId)),
								eq(LedgerAccountsTable.ledgerId, encodeUuid(ledgerId))
							)
						);
					await tx
						.delete(LedgersTable)
						.where(
							and(
								eq(LedgersTable.organizationId, encodeUuid(organizationId)),
								eq(LedgersTable.id, encodeUuid(ledgerId))
							)
						);
				}),
			catch: mapLedgerDeleteError,
		});
	}
}

const ledgerRepoLayer = Layer.effect(
	LedgerRepoTag,
	DatabaseTag.pipe(Effect.map(database => new LedgerRepoLive(database.db)))
);

export type {
	LedgerCreateRepositoryError,
	LedgerDeleteRepositoryError,
	LedgerListQuery,
	LedgerRepo,
};
export type { LedgerInfrastructureError } from "./LedgerErrors";
export { LedgerRepoLive, LedgerRepoTag, ledgerRepoLayer };
