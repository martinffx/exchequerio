import { Clock, Context, Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";

import { InvalidId } from "@/lib/errors";
import { parseId } from "@/lib/utils";
import {
	newLedgerAccountBalanceMonitorID,
	type LedgerAccountBalanceMonitorID,
	type LedgerAccountID,
} from "@/lib/ids";

import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import {
	type LedgerAccountBalanceMonitorInfrastructureError,
	LedgerAccountBalanceMonitorNotFound,
	LedgerAccountBalanceMonitorPersistenceFailure,
} from "./LedgerAccountBalanceMonitorErrors";
import {
	type LedgerAccountBalanceMonitorRepo,
	LedgerAccountBalanceMonitorRepoTag,
} from "./LedgerAccountBalanceMonitorRepo";
import type { LedgerAccountBalanceMonitorRequest } from "./LedgerAccountBalanceMonitorSchema";

type LedgerAccountBalanceMonitorListError = LedgerAccountBalanceMonitorInfrastructureError;
type LedgerAccountBalanceMonitorGetError =
	| InvalidId
	| LedgerAccountBalanceMonitorNotFound
	| LedgerAccountBalanceMonitorInfrastructureError;
type LedgerAccountBalanceMonitorCreateError = LedgerAccountBalanceMonitorInfrastructureError;
type LedgerAccountBalanceMonitorUpdateError = LedgerAccountBalanceMonitorGetError;
type LedgerAccountBalanceMonitorDeleteError = LedgerAccountBalanceMonitorGetError;

const serverTime = Clock.currentTimeMillis.pipe(
	Effect.map(milliseconds => DateTime.fromMillis(milliseconds, { zone: "utc" }))
);

const requireFound =
	<A>(id: LedgerAccountBalanceMonitorID) =>
	(value: Option.Option<A>): Effect.Effect<A, LedgerAccountBalanceMonitorNotFound> =>
		Option.match(value, {
			onNone: () => Effect.fail(new LedgerAccountBalanceMonitorNotFound(id)),
			onSome: Effect.succeed,
		});

const parseAccountId = (
	value: string
): Effect.Effect<LedgerAccountID, LedgerAccountBalanceMonitorPersistenceFailure> =>
	parseId<"lat", LedgerAccountID>("lat", value).pipe(
		Effect.mapError(
			() => new LedgerAccountBalanceMonitorPersistenceFailure(new Error("Invalid Ledger Account ID"))
		)
	);

class LedgerAccountBalanceMonitorService {
	constructor(private readonly repository: LedgerAccountBalanceMonitorRepo) {}

	listLedgerAccountBalanceMonitors(
		offset: number,
		limit: number
	): Effect.Effect<LedgerAccountBalanceMonitor[], LedgerAccountBalanceMonitorListError> {
		return this.repository.listMonitors({ offset, limit });
	}

	getLedgerAccountBalanceMonitor(
		id: string
	): Effect.Effect<LedgerAccountBalanceMonitor, LedgerAccountBalanceMonitorGetError> {
		return parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", id).pipe(
			Effect.flatMap(monitorId =>
				this.repository.getMonitor(monitorId).pipe(Effect.flatMap(requireFound(monitorId)))
			)
		);
	}

	createLedgerAccountBalanceMonitor(
		request: LedgerAccountBalanceMonitorRequest
	): Effect.Effect<LedgerAccountBalanceMonitor, LedgerAccountBalanceMonitorCreateError> {
		return Effect.all({
			id: Effect.sync(newLedgerAccountBalanceMonitorID),
			accountId: parseAccountId(request.accountId),
			applicationTime: serverTime,
		}).pipe(
			Effect.map(({ id, accountId, applicationTime }) =>
				LedgerAccountBalanceMonitor.fromRequest(id, accountId, request, applicationTime)
			),
			Effect.flatMap(record => this.repository.createMonitor(record))
		);
	}

	updateLedgerAccountBalanceMonitor(
		id: string,
		request: LedgerAccountBalanceMonitorRequest
	): Effect.Effect<LedgerAccountBalanceMonitor, LedgerAccountBalanceMonitorUpdateError> {
		return Effect.all({
			id: parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", id),
			accountId: parseAccountId(request.accountId),
			applicationTime: serverTime,
		}).pipe(
			Effect.map(({ id: monitorId, accountId, applicationTime }) => ({
				monitorId,
				record: LedgerAccountBalanceMonitor.fromRequest(monitorId, accountId, request, applicationTime),
			})),
			Effect.flatMap(({ monitorId, record }) =>
				this.repository.updateMonitor(monitorId, record).pipe(Effect.flatMap(requireFound(monitorId)))
			)
		);
	}

	deleteLedgerAccountBalanceMonitor(
		id: string
	): Effect.Effect<void, LedgerAccountBalanceMonitorDeleteError> {
		return parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", id).pipe(
			Effect.flatMap(monitorId =>
				this.repository.deleteMonitor(monitorId).pipe(Effect.flatMap(requireFound(monitorId)))
			)
		);
	}
}

const LedgerAccountBalanceMonitorServiceTag = Context.Service<LedgerAccountBalanceMonitorService>(
	"LedgerAccountBalanceMonitorService"
);

const ledgerAccountBalanceMonitorServiceLayer = Layer.effect(
	LedgerAccountBalanceMonitorServiceTag,
	LedgerAccountBalanceMonitorRepoTag.pipe(
		Effect.map(repository => new LedgerAccountBalanceMonitorService(repository))
	)
);

export type {
	LedgerAccountBalanceMonitorCreateError,
	LedgerAccountBalanceMonitorDeleteError,
	LedgerAccountBalanceMonitorGetError,
	LedgerAccountBalanceMonitorListError,
	LedgerAccountBalanceMonitorUpdateError,
};
export {
	LedgerAccountBalanceMonitorService,
	LedgerAccountBalanceMonitorServiceTag,
	ledgerAccountBalanceMonitorServiceLayer,
};
