import { Context, Effect, Layer, Option } from "effect";
import { TypeID } from "typeid-js";
import { ServiceUnavailableError } from "@/lib/errors";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import type { Ledger } from "./domain/Ledger";
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
		return this.repository.list(organizationId, query);
	}

	getLedger(organizationId: OrgID, ledgerId: LedgerID): Effect.Effect<Ledger, LedgerGetError> {
		return this.repository
			.get(organizationId, ledgerId)
			.pipe(Effect.flatMap(requireFound(organizationId, ledgerId)));
	}

	createLedger(
		organizationId: OrgID,
		request: LedgerCreateRequest
	): Effect.Effect<Ledger, LedgerCreateError> {
		return Effect.sync(() => new TypeID("lgr") as LedgerID).pipe(
			Effect.flatMap(id =>
				this.repository.create({
					id,
					organizationId,
					...request,
				})
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
			.update({ id: ledgerId, organizationId, ...request })
			.pipe(Effect.flatMap(requireFound(organizationId, ledgerId)));
	}

	deleteLedger(organizationId: OrgID, ledgerId: LedgerID): Effect.Effect<void, LedgerDeleteError> {
		return this.repository
			.delete(organizationId, ledgerId)
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
