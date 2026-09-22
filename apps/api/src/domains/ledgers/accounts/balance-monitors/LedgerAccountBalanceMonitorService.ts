import { parseAmount } from "@/lib/amounts";
import { validateHeaderValue } from "node:http";
import { Clock, Context, Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";
import { BadRequestError, ServiceUnavailableError } from "@/lib/errors";
import { encodeMetadata, parseId } from "@/lib/utils";
import {
	newLedgerAccountBalanceMonitorID,
	type LedgerAccountBalanceMonitorID,
	type LedgerAccountID,
	type LedgerID,
} from "@/lib/ids";
import { LedgerAccountBalanceMonitor, type MonitorScope } from "./LedgerAccountBalanceMonitor";
import { LedgerAccountBalanceMonitorNotFound } from "./LedgerAccountBalanceMonitorErrors";
import {
	type LedgerAccountBalanceMonitorRepo,
	LedgerAccountBalanceMonitorRepoTag,
} from "./LedgerAccountBalanceMonitorRepo";
import type {
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorUpdateRequest,
} from "./LedgerAccountBalanceMonitorSchema";
import { encryptToken } from "./MonitorSecrets";
import { validateWebhookUrl } from "./MonitorWebhook";
const serverTime = Clock.currentTimeMillis.pipe(
	Effect.map(milliseconds => DateTime.fromMillis(milliseconds, { zone: "utc" }))
);
const parseScope = (scope: MonitorScope) =>
	Effect.all([
		parseId<"lgr", LedgerID>("lgr", scope.ledgerId),
		parseId<"lat", LedgerAccountID>("lat", scope.accountId),
	]).pipe(Effect.as(scope));
const requireFound =
	<A>(id: LedgerAccountBalanceMonitorID) =>
	(value: Option.Option<A>) =>
		Option.match(value, {
			onNone: () => Effect.fail(new LedgerAccountBalanceMonitorNotFound(id)),
			onSome: Effect.succeed,
		});
export class LedgerAccountBalanceMonitorService {
	constructor(
		private readonly repository: LedgerAccountBalanceMonitorRepo,
		private readonly encryptionKey: string
	) {}
	private webhook(request: LedgerAccountBalanceMonitorUpdateRequest) {
		return Effect.gen({ self: this }, function* () {
			yield* Effect.try({
				try: () => {
					for (const condition of request.alertCondition.conditions) parseAmount(condition.value);
				},
				catch: error => error as BadRequestError,
			});
			yield* Effect.try({
				try: () => validateWebhookUrl(request.webhook.url),
				catch: () => new BadRequestError("Webhook URL must be a public HTTPS destination"),
			});
			if (request.webhook.bearerToken !== undefined) {
				yield* Effect.try({
					try: () => validateHeaderValue("Authorization", `Bearer ${request.webhook.bearerToken}`),
					catch: () =>
						new BadRequestError("Webhook bearer token contains invalid HTTP header characters"),
				});
			}
			const encrypted = yield* Effect.try({
				try: () => encryptToken(request.webhook.bearerToken ?? "", this.encryptionKey),
				catch: () => new ServiceUnavailableError("Balance monitor configuration unavailable"),
			});
			return {
				webhookUrl: request.webhook.url,
				...(request.webhook.bearerToken === undefined ? {} : { webhookToken: encrypted }),
			};
		});
	}
	listLedgerAccountBalanceMonitors(scope: MonitorScope, offset: number, limit: number) {
		return parseScope(scope).pipe(
			Effect.flatMap(() => this.repository.listMonitors(scope, { offset, limit }))
		);
	}
	getLedgerAccountBalanceMonitor(scope: MonitorScope, id: string) {
		return Effect.gen({ self: this }, function* () {
			yield* parseScope(scope);
			const monitorId = yield* parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", id);
			return yield* this.repository
				.getMonitor(scope, monitorId)
				.pipe(Effect.flatMap(requireFound(monitorId)));
		});
	}
	createLedgerAccountBalanceMonitor(
		scope: MonitorScope,
		request: LedgerAccountBalanceMonitorRequest
	) {
		return Effect.gen({ self: this }, function* () {
			yield* parseScope(scope);
			const webhook = yield* this.webhook(request);
			const time = yield* serverTime;
			const record = yield* LedgerAccountBalanceMonitor.fromRequest(
				newLedgerAccountBalanceMonitorID(),
				scope,
				request,
				time,
				webhook.webhookToken!
			);
			return yield* this.repository.createMonitor(record);
		});
	}
	updateLedgerAccountBalanceMonitor(
		scope: MonitorScope,
		id: string,
		request: LedgerAccountBalanceMonitorUpdateRequest
	) {
		return Effect.gen({ self: this }, function* () {
			yield* parseScope(scope);
			const monitorId = yield* parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", id);
			const webhook = yield* this.webhook(request);
			const time = yield* serverTime;
			return yield* this.repository
				.updateMonitor(
					scope,
					monitorId,
					{
						...webhook,
						description: request.description,
						alertCondition: request.alertCondition,
						metadata: encodeMetadata(request.metadata),
					},
					time.toJSDate()
				)
				.pipe(Effect.flatMap(requireFound(monitorId)));
		});
	}
	deleteLedgerAccountBalanceMonitor(scope: MonitorScope, id: string) {
		return Effect.gen({ self: this }, function* () {
			yield* parseScope(scope);
			const monitorId = yield* parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", id);
			return yield* this.repository
				.deleteMonitor(scope, monitorId)
				.pipe(Effect.flatMap(requireFound(monitorId)));
		});
	}
}
export const LedgerAccountBalanceMonitorServiceTag =
	Context.Service<LedgerAccountBalanceMonitorService>("LedgerAccountBalanceMonitorService");
export const ledgerAccountBalanceMonitorServiceLayer = (encryptionKey: string) =>
	Layer.effect(
		LedgerAccountBalanceMonitorServiceTag,
		LedgerAccountBalanceMonitorRepoTag.pipe(
			Effect.map(repository => new LedgerAccountBalanceMonitorService(repository, encryptionKey))
		)
	);
