import { Effect } from "effect";
import { DateTime } from "luxon";
import { type Metadata, encodeMetadata, parseDate, parseId, parseMetadata } from "@/lib/utils";
import type { LedgerAccountBalanceMonitorID, LedgerAccountID } from "@/repo/entities/types";
import type { LedgerAccountBalanceMonitorRow } from "@/repo/schema";
import { LedgerAccountBalanceMonitorPersistenceDecodingFailure } from "./LedgerAccountBalanceMonitorErrors";
import type {
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
} from "./LedgerAccountBalanceMonitorSchema";

export type MonitorScope = Pick<
	LedgerAccountBalanceMonitorRow,
	"organizationId" | "ledgerId" | "accountId"
>;
export class LedgerAccountBalanceMonitor {
	private constructor(
		readonly row: LedgerAccountBalanceMonitorRow,
		readonly id: LedgerAccountBalanceMonitorID,
		readonly accountId: LedgerAccountID,
		readonly metadata: Metadata | undefined
	) {}
	static fromRequest(
		id: LedgerAccountBalanceMonitorID,
		scope: MonitorScope,
		request: LedgerAccountBalanceMonitorRequest,
		applicationTime: DateTime,
		encryptedToken: string
	) {
		return LedgerAccountBalanceMonitor.fromRow({
			...scope,
			id: id.toString(),
			// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns use null.
			description: request.description ?? null,
			alertCondition: request.alertCondition,
			webhookUrl: request.webhook.url,
			webhookToken: encryptedToken,
			// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns use null.
			metadata: encodeMetadata(request.metadata) ?? null,
			lockVersion: 1,
			// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns use null.
			deletedAt: null,
			created: applicationTime.toJSDate(),
			updated: applicationTime.toJSDate(),
		});
	}
	static fromRow(row: LedgerAccountBalanceMonitorRow) {
		return Effect.all({
			id: parseId<"lbm", LedgerAccountBalanceMonitorID>("lbm", row.id),
			accountId: parseId<"lat", LedgerAccountID>("lat", row.accountId),
			created: parseDate(row.created),
			updated: parseDate(row.updated),
			metadata: parseMetadata(row.metadata).pipe(Effect.catch(() => Effect.succeed(undefined))),
		}).pipe(
			Effect.map(
				decoded => new LedgerAccountBalanceMonitor(row, decoded.id, decoded.accountId, decoded.metadata)
			),
			Effect.mapError(cause => new LedgerAccountBalanceMonitorPersistenceDecodingFailure(cause))
		);
	}
	toResponse(): LedgerAccountBalanceMonitorResponse {
		return {
			id: this.row.id,
			accountId: this.row.accountId,
			ledgerId: this.row.ledgerId,
			description: this.row.description ?? undefined,
			alertCondition: this.row.alertCondition,
			webhook: { url: this.row.webhookUrl },
			metadata: this.metadata,
			lockVersion: this.row.lockVersion,
			created: this.row.created.toISOString(),
			updated: this.row.updated.toISOString(),
		};
	}
	toCreateRow() {
		return this.row;
	}
}
