import { parseAmount } from "@/lib/amounts";
import { TypeID } from "typeid-js";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	type Metadata,
	encodeMetadata,
	parseDate,
	parseUuid,
	encodeUuid,
	parseMetadata,
} from "@/lib/utils";
import type { LedgerAccountBalanceMonitorID, LedgerAccountID } from "@/lib/ids";
import type { LedgerAccountBalanceMonitorRow } from "@/db/schema";
import { LedgerAccountBalanceMonitorPersistenceDecodingFailure } from "./LedgerAccountBalanceMonitorErrors";
import type {
	AlertCondition,
	BalanceSnapshot,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
} from "./LedgerAccountBalanceMonitorSchema";

export type MonitorScope = Pick<
	LedgerAccountBalanceMonitorRow,
	"organizationId" | "ledgerId" | "accountId"
>;
export type LedgerAccountBalanceMonitorRecord = LedgerAccountBalanceMonitor & {
	readonly row: LedgerAccountBalanceMonitorRow;
	readonly id: LedgerAccountBalanceMonitorID;
	readonly accountId: LedgerAccountID;
	readonly metadata: Metadata | undefined;
};

export class LedgerAccountBalanceMonitor {
	private constructor(readonly alertCondition: AlertCondition) {}

	static fromConfiguration(configuration: Pick<LedgerAccountBalanceMonitorRow, "alertCondition">) {
		return new LedgerAccountBalanceMonitor(configuration.alertCondition);
	}

	/** A complete accounting mutation is one transition, independent of worker arrival order. */
	crossed(before: BalanceSnapshot, after: BalanceSnapshot): boolean {
		return !this.matches(before) && this.matches(after);
	}

	private matches(balances: BalanceSnapshot): boolean {
		const compare = (item: AlertCondition["conditions"][number]): boolean => {
			const amount = parseAmount(balances[item.balanceType]);
			const threshold = parseAmount(item.value);
			switch (item.operator) {
				case "=":
					return amount === threshold;
				case "!=":
					return amount !== threshold;
				case "<":
					return amount < threshold;
				case "<=":
					return amount <= threshold;
				case ">":
					return amount > threshold;
				case ">=":
					return amount >= threshold;
			}
		};
		return this.alertCondition.mode === "all"
			? this.alertCondition.conditions.every(compare)
			: this.alertCondition.conditions.some(compare);
	}

	static fromRequest(
		id: LedgerAccountBalanceMonitorID,
		scope: MonitorScope,
		request: LedgerAccountBalanceMonitorRequest,
		applicationTime: DateTime,
		encryptedSecret: string
	) {
		return LedgerAccountBalanceMonitor.fromRow({
			organizationId: encodeUuid(TypeID.fromString(scope.organizationId)),
			ledgerId: encodeUuid(TypeID.fromString(scope.ledgerId)),
			accountId: encodeUuid(TypeID.fromString(scope.accountId)),
			id: encodeUuid(id),
			// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns use null.
			description: request.description ?? null,
			alertCondition: request.alertCondition,
			webhookUrl: request.webhook.url,
			webhookSigningSecret: encryptedSecret,
			// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns use null.
			metadata: encodeMetadata(request.metadata) ?? null,
			lockVersion: 1,
			created: applicationTime.toJSDate(),
			updated: applicationTime.toJSDate(),
		});
	}
	static fromRow(row: LedgerAccountBalanceMonitorRow) {
		return Effect.all({
			id: parseUuid<"lbm", LedgerAccountBalanceMonitorID>("lbm", row.id),
			accountId: parseUuid<"lat", LedgerAccountID>("lat", row.accountId),
			created: parseDate(row.created),
			updated: parseDate(row.updated),
			metadata: parseMetadata(row.metadata).pipe(Effect.catch(() => Effect.succeed(undefined))),
		}).pipe(
			Effect.map(decoded =>
				Object.assign(LedgerAccountBalanceMonitor.fromConfiguration(row), {
					row,
					id: decoded.id,
					accountId: decoded.accountId,
					metadata: decoded.metadata,
				})
			),
			Effect.mapError(cause => new LedgerAccountBalanceMonitorPersistenceDecodingFailure(cause))
		);
	}
	toResponse(this: LedgerAccountBalanceMonitorRecord): LedgerAccountBalanceMonitorResponse {
		return {
			id: this.id.toString(),
			accountId: this.accountId.toString(),
			ledgerId: TypeID.fromUUID("lgr", this.row.ledgerId).toString(),
			description: this.row.description ?? undefined,
			alertCondition: this.row.alertCondition,
			webhook: { url: this.row.webhookUrl },
			metadata: this.metadata,
			lockVersion: this.row.lockVersion,
			created: this.row.created.toISOString(),
			updated: this.row.updated.toISOString(),
		};
	}
	toCreateRow(this: LedgerAccountBalanceMonitorRecord) {
		return this.row;
	}
}
