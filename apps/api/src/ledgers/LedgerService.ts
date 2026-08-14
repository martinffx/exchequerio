import { Context, Effect, Layer, Option } from "effect";
import { ServiceUnavailableError } from "@/lib/errors";
import { type LedgerID, newLedgerID, type OrgID } from "@/repo/entities/types";
import { Ledger } from "./domain/Ledger";
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

const requireFound = <A>(
	organizationId: OrgID,
	ledgerId: LedgerID
): ((value: Option.Option<A>) => Effect.Effect<A, LedgerNotFound>) =>
	Option.match({
		onNone: () => Effect.fail(new LedgerNotFound(organizationId.toString(), ledgerId.toString())),
		onSome: Effect.succeed,
	});

class LedgerService {
	constructor(private readonly repository: LedgerRepo) {}

	listLedgers(
		organizationId: OrgID,
		query: LedgerListQuery
	): Effect.Effect<Ledger[], LedgerListError> {
		return this.repository.listLedgers(organizationId, query);
	}

	getLedger(organizationId: OrgID, ledgerId: LedgerID): Effect.Effect<Ledger, LedgerGetError> {
		return this.repository
			.getLedger(organizationId, ledgerId)
			.pipe(Effect.flatMap(requireFound(organizationId, ledgerId)));
	}

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
					? new ServiceUnavailableError(error.message, {
							...error.context,
							cause: error,
							retryable: false,
						})
					: error
			)
		);
	}

	updateLedger(
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerUpdateRequest
	): Effect.Effect<Ledger, LedgerUpdateError> {
		return this.repository
			.updateLedger(Ledger.fromRequest(ledgerId, organizationId, request))
			.pipe(Effect.flatMap(requireFound(organizationId, ledgerId)));
	}

	deleteLedger(organizationId: OrgID, ledgerId: LedgerID): Effect.Effect<Ledger, LedgerDeleteError> {
		return this.repository
			.deleteLedger(organizationId, ledgerId)
			.pipe(Effect.flatMap(requireFound(organizationId, ledgerId)));
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
