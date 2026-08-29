import { Context, Effect, Layer, Option } from "effect";
import { ServiceUnavailableError } from "@/lib/errors";
import { type LedgerID, newLedgerID, type OrgID } from "@/repo/entities/types";
import { Ledger } from "./Ledger";
import { LedgerNotFound, LedgerRepositoryUnavailable } from "./LedgerErrors";
import {
	type LedgerCreateRepositoryError,
	type LedgerDeleteRepositoryError,
	type LedgerInfrastructureError,
	type LedgerListQuery,
	type LedgerRepo,
	LedgerRepoTag,
} from "./LedgerRepo";
import type { LedgerCreateRequest, LedgerUpdateRequest } from "./LedgerSchema";

type LedgerListError = LedgerInfrastructureError;
type LedgerGetError = LedgerNotFound | LedgerInfrastructureError;
type LedgerCreateError =
	| Exclude<LedgerCreateRepositoryError, LedgerRepositoryUnavailable>
	| ServiceUnavailableError;
type LedgerUpdateError = LedgerNotFound | LedgerInfrastructureError;
type LedgerDeleteError = LedgerNotFound | LedgerDeleteRepositoryError;

const requireFound = <A>(): ((value: Option.Option<A>) => Effect.Effect<A, LedgerNotFound>) =>
	Option.match({
		onNone: () => Effect.fail(new LedgerNotFound()),
		onSome: Effect.succeed,
	});

/** Orchestrates Ledger use cases within an Organization. */
class LedgerService {
	/**
	 * Creates a Ledger service.
	 *
	 * @param repository - Repository used for Ledger persistence.
	 */
	constructor(private readonly repository: LedgerRepo) {}

	/**
	 * Lists Ledgers owned by one Organization.
	 *
	 * @param organizationId - Organization that owns the Ledgers.
	 * @param query - Pagination parameters for the result set.
	 * @returns An Effect containing the requested page of Ledgers.
	 */
	listLedgers(
		organizationId: OrgID,
		query: LedgerListQuery
	): Effect.Effect<Ledger[], LedgerListError> {
		return this.repository.listLedgers(organizationId, query);
	}

	/**
	 * Gets a tenant-scoped Ledger and converts repository absence into `LedgerNotFound`.
	 *
	 * @param organizationId - Organization that owns the Ledger.
	 * @param ledgerId - Ledger to get.
	 * @returns An Effect containing the Ledger.
	 */
	getLedger(organizationId: OrgID, ledgerId: LedgerID): Effect.Effect<Ledger, LedgerGetError> {
		return this.repository.getLedger(organizationId, ledgerId).pipe(Effect.flatMap(requireFound()));
	}

	/**
	 * Generates an identifier, builds a Ledger, and persists it for an Organization.
	 *
	 * Repository unavailability is exposed as a non-retryable service-unavailable failure.
	 *
	 * @param organizationId - Organization that will own the Ledger.
	 * @param request - Validated Ledger creation request.
	 * @returns An Effect containing the created Ledger.
	 */
	createLedger(
		organizationId: OrgID,
		request: LedgerCreateRequest
	): Effect.Effect<Ledger, LedgerCreateError> {
		return Effect.sync(newLedgerID).pipe(
			Effect.flatMap(id =>
				this.repository.createLedger(Ledger.fromRequest(id, organizationId, request))
			),
			Effect.mapError(error =>
				error instanceof LedgerRepositoryUnavailable
					? new ServiceUnavailableError(error.message, { cause: error, retryable: false })
					: error
			)
		);
	}

	/**
	 * Replaces a tenant-scoped Ledger's mutable fields and requires the Ledger to exist.
	 *
	 * @param organizationId - Organization that owns the Ledger.
	 * @param ledgerId - Ledger to update.
	 * @param request - Validated Ledger update request.
	 * @returns An Effect containing the updated Ledger.
	 */
	updateLedger(
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerUpdateRequest
	): Effect.Effect<Ledger, LedgerUpdateError> {
		return this.repository
			.updateLedger(Ledger.fromRequest(ledgerId, organizationId, request))
			.pipe(Effect.flatMap(requireFound()));
	}

	/**
	 * Deletes a tenant-scoped Ledger and requires the Ledger to exist.
	 *
	 * @param organizationId - Organization that owns the Ledger.
	 * @param ledgerId - Ledger to delete.
	 * @returns An Effect containing the deleted Ledger.
	 */
	deleteLedger(organizationId: OrgID, ledgerId: LedgerID): Effect.Effect<Ledger, LedgerDeleteError> {
		return this.repository
			.deleteLedger(organizationId, ledgerId)
			.pipe(Effect.flatMap(requireFound()));
	}
}

const LedgerServiceTag = Context.Service<LedgerService>("LedgerService");

const ledgerServiceLayer = Layer.effect(
	LedgerServiceTag,
	LedgerRepoTag.pipe(Effect.map(repository => new LedgerService(repository)))
);

export type {
	LedgerCreateError,
	LedgerDeleteError,
	LedgerGetError,
	LedgerListError,
	LedgerUpdateError,
};
export { LedgerService, LedgerServiceTag, ledgerServiceLayer };
