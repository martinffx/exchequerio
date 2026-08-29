import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { describe, expect, it } from "vitest";

import type { LedgerAccountBalanceMonitorID, LedgerAccountID } from "@/repo/entities/types";
import type { LedgerAccountBalanceMonitorRow } from "@/repo/schema";

import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import type { LedgerAccountBalanceMonitorRequest } from "./LedgerAccountBalanceMonitorSchema";

const monitorId = TypeID.fromString<"lbm">(
	"lbm_01h2x3y4z5a6b7c8d9e0f1g2h3"
) as LedgerAccountBalanceMonitorID;
const accountId = TypeID.fromString<"lat">("lat_01h2x3y4z5a6b7c8d9e0f1g2h4") as LedgerAccountID;
const applicationTime = DateTime.fromISO("2026-08-29T10:15:30.000Z", { zone: "utc" });

const request: LedgerAccountBalanceMonitorRequest = {
	accountId: accountId.toString(),
	description: "Low balance",
	alertCondition: [{ field: "balance", operator: "<", value: 1000 }],
	metadata: { team: "treasury" },
};

const row = (overrides: Partial<LedgerAccountBalanceMonitorRow> = {}) =>
	({
		id: monitorId.toString(),
		accountId: accountId.toString(),
		name: "Low balance",
		description: "Low balance",
		alertThreshold: "12.3400",
		isActive: 0,
		metadata: JSON.stringify({ team: "treasury" }),
		created: new Date("2026-08-28T09:00:00.000Z"),
		updated: new Date("2026-08-29T10:15:30.000Z"),
		...overrides,
	}) satisfies LedgerAccountBalanceMonitorRow;

const decode = (record: LedgerAccountBalanceMonitorRow) =>
	Effect.runSync(LedgerAccountBalanceMonitor.fromRow(record)).pipe(Option.getOrThrow);

describe("LedgerAccountBalanceMonitor", () => {
	it("constructs the current domain defaults from a request and supplied application values", () => {
		const monitor = LedgerAccountBalanceMonitor.fromRequest(
			monitorId,
			accountId,
			request,
			applicationTime
		);

		expect(monitor).toMatchObject({
			id: monitorId,
			accountId,
			name: "Low balance",
			description: "Low balance",
			alertThreshold: 0,
			isActive: true,
			metadata: { team: "treasury" },
			created: applicationTime,
			updated: applicationTime,
		});
		expect(monitor).not.toHaveProperty("alertCondition");
	});

	it("uses the existing default name and ignores alert conditions", () => {
		const monitor = LedgerAccountBalanceMonitor.fromRequest(
			monitorId,
			accountId,
			{ ...request, description: undefined },
			applicationTime
		);

		expect(monitor.name).toBe("Balance Monitor");
		expect(monitor.description).toBeUndefined();
		expect(monitor).not.toHaveProperty("alertCondition");
	});

	it("decodes every stored value from a Drizzle row", () => {
		const monitor = decode(row());

		expect(monitor).toMatchObject({
			id: monitorId,
			accountId,
			name: "Low balance",
			description: "Low balance",
			alertThreshold: 12.34,
			isActive: false,
			metadata: { team: "treasury" },
		});
		expect(monitor.created.toISO()).toBe("2026-08-28T09:00:00.000Z");
		expect(monitor.updated.toISO()).toBe("2026-08-29T10:15:30.000Z");
	});

	it.each([
		// oxlint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
		["absent", null],
		["malformed", "not-json"],
	] as const)("treats %s persisted metadata as absent", (_label, metadata) => {
		expect(decode(row({ metadata })).metadata).toBeUndefined();
	});

	it("keeps create and update persistence encodings distinct", () => {
		const monitor = LedgerAccountBalanceMonitor.fromRequest(
			monitorId,
			accountId,
			request,
			applicationTime
		);

		expect(monitor.toCreateRow()).toEqual({
			id: monitorId.toString(),
			accountId: accountId.toString(),
			name: "Low balance",
			description: "Low balance",
			alertThreshold: "0",
			isActive: 1,
			metadata: JSON.stringify({ team: "treasury" }),
			updated: applicationTime.toJSDate(),
		});
		expect(monitor.toUpdateRow()).toEqual({
			id: monitorId.toString(),
			accountId: accountId.toString(),
			name: "Low balance",
			description: "Low balance",
			alertThreshold: "0",
			isActive: 1,
			metadata: JSON.stringify({ team: "treasury" }),
			updated: applicationTime.toJSDate(),
		});
	});

	it("preserves undefined update fields so Drizzle omits them", () => {
		const monitor = LedgerAccountBalanceMonitor.fromRequest(
			monitorId,
			accountId,
			{ ...request, description: undefined, metadata: undefined },
			applicationTime
		);

		expect(monitor.toUpdateRow()).toMatchObject({
			description: undefined,
			metadata: undefined,
		});
	});

	it("serializes the unchanged placeholder response", () => {
		const response = decode(
			row({
				// oxlint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
				description: null,
				// oxlint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
				metadata: null,
			})
		).toResponse();

		expect(response).toEqual({
			id: monitorId.toString(),
			accountId: accountId.toString(),
			description: undefined,
			alertCondition: [],
			balances: [
				{
					balanceType: "pending",
					amount: 0,
					currency: "USD",
					currencyExponent: 2,
					credits: 0,
					debits: 0,
				},
				{
					balanceType: "posted",
					amount: 0,
					currency: "USD",
					currencyExponent: 2,
					credits: 0,
					debits: 0,
				},
				{
					balanceType: "availableBalance",
					amount: 0,
					currency: "USD",
					currencyExponent: 2,
					credits: 0,
					debits: 0,
				},
			],
			metadata: undefined,
			lockVersion: 0,
			created: "2026-08-28T09:00:00.000Z",
			updated: "2026-08-29T10:15:30.000Z",
		});
	});
});
