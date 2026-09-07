import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import {
	newOrgID,
	newLedgerID,
	newLedgerAccountID,
	newLedgerAccountBalanceMonitorID,
} from "@/lib/ids";
import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";
import type { LedgerAccountBalanceMonitorRepo } from "./LedgerAccountBalanceMonitorRepo";
import type { LedgerAccountBalanceMonitorRequest } from "./LedgerAccountBalanceMonitorSchema";
import { decryptToken } from "./MonitorSecrets";
const scope = {
	organizationId: newOrgID().toString(),
	ledgerId: newLedgerID().toString(),
	accountId: newLedgerAccountID().toString(),
};
const key = Buffer.alloc(32, 7).toString("base64");
const request: LedgerAccountBalanceMonitorRequest = {
	alertCondition: {
		mode: "all",
		conditions: [{ balanceType: "posted", operator: "<", value: "100" }],
	},
	webhook: { url: "https://example.com/hook", bearerToken: "secret" },
	metadata: { team: "treasury" },
};
const record = Effect.runSync(
	LedgerAccountBalanceMonitor.fromRequest(
		newLedgerAccountBalanceMonitorID(),
		scope,
		request,
		DateTime.utc(),
		"ciphertext"
	)
);
const repo = () =>
	({
		listMonitors: vi.fn(() => Effect.succeed([record])),
		// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
		getMonitor: vi.fn(() => Effect.succeed(Option.some(record))),
		createMonitor: vi.fn((value: LedgerAccountBalanceMonitor) => Effect.succeed(value)),
		// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
		updateMonitor: vi.fn(() => Effect.succeed(Option.some(record))),
		// oxlint-disable-next-line unicorn/no-array-callback-reference -- Option.some constructs the optional result.
		deleteMonitor: vi.fn(() => Effect.succeed(Option.some(undefined))),
	}) satisfies LedgerAccountBalanceMonitorRepo;
describe("Balance monitor service", () => {
	it("encrypts credentials and returns real configuration without secrets", async () => {
		const repository = repo();
		const service = new LedgerAccountBalanceMonitorService(repository, key);
		const created = await Effect.runPromise(
			service.createLedgerAccountBalanceMonitor(scope, request)
		);
		expect(decryptToken(created.row.webhookToken, key)).toBe("secret");
		expect(created.toResponse()).toMatchObject({
			alertCondition: request.alertCondition,
			webhook: { url: request.webhook.url },
			lockVersion: 1,
			metadata: request.metadata,
		});
		expect(JSON.stringify(created.toResponse())).not.toContain("secret");
		expect(created.toResponse()).not.toHaveProperty("balances");
	});
	it("passes authenticated scope and preserves omitted token on update", async () => {
		const repository = repo();
		const service = new LedgerAccountBalanceMonitorService(repository, key);
		await Effect.runPromise(
			service.updateLedgerAccountBalanceMonitor(scope, record.id.toString(), {
				...request,
				webhook: { url: request.webhook.url },
			})
		);
		expect(repository.updateMonitor.mock.calls[0]).toEqual([
			scope,
			record.id,
			{
				webhookUrl: request.webhook.url,
				description: undefined,
				alertCondition: request.alertCondition,
				metadata: JSON.stringify(request.metadata),
			},
			expect.any(Date),
		]);
	});
	it.each(["", "invalid"])("sanitizes invalid encryption configuration %s", async invalid => {
		const repository = repo();
		const error = await Effect.runPromise(
			Effect.flip(
				new LedgerAccountBalanceMonitorService(repository, invalid).createLedgerAccountBalanceMonitor(
					scope,
					request
				)
			)
		);
		expect(error).toMatchObject({
			statusCode: 503,
			message: "Balance monitor configuration unavailable",
		});
		expect(repository.createMonitor).not.toHaveBeenCalled();
	});
	it("rejects non-public webhook URLs before persistence", async () => {
		const repository = repo();
		const error = await Effect.runPromise(
			Effect.flip(
				new LedgerAccountBalanceMonitorService(repository, key).createLedgerAccountBalanceMonitor(
					scope,
					{ ...request, webhook: { ...request.webhook, url: "http://localhost" } }
				)
			)
		);
		expect(error).toMatchObject({ statusCode: 400 });
		expect(repository.createMonitor).not.toHaveBeenCalled();
	});
	it.each(["secret\r\nInjected: value", "secret\n", "secret\u0100"])(
		"rejects invalid bearer header characters on create and update (%#)",
		async bearerToken => {
			const repository = repo();
			const service = new LedgerAccountBalanceMonitorService(repository, key);
			const invalid = { ...request, webhook: { ...request.webhook, bearerToken } };
			for (const action of [
				service.createLedgerAccountBalanceMonitor(scope, invalid),
				service.updateLedgerAccountBalanceMonitor(scope, record.id.toString(), invalid),
			]) {
				const error = await Effect.runPromise(Effect.flip(action));
				expect(error).toMatchObject({
					statusCode: 400,
					message: "Webhook bearer token contains invalid HTTP header characters",
				});
				expect(error.message).not.toContain(bearerToken);
			}
			expect(repository.createMonitor).not.toHaveBeenCalled();
			expect(repository.updateMonitor).not.toHaveBeenCalled();
		}
	);
	it("maps absent monitors to 404 and malformed IDs to 400", async () => {
		const repository = repo();
		repository.getMonitor.mockReturnValueOnce(Effect.succeed(Option.none()));
		const service = new LedgerAccountBalanceMonitorService(repository, key);
		expect(
			await Effect.runPromise(
				Effect.flip(service.getLedgerAccountBalanceMonitor(scope, record.id.toString()))
			)
		).toMatchObject({ statusCode: 404 });
		expect(
			await Effect.runPromise(Effect.flip(service.getLedgerAccountBalanceMonitor(scope, "invalid")))
		).toMatchObject({ statusCode: 400 });
	});
	it.each(["9223372036854775808", "-9223372036854775809", "01", "-0", "+1", " 1", "1e3", "1.0"])(
		"rejects invalid threshold %s on create and update",
		async value => {
			const repository = repo();
			const service = new LedgerAccountBalanceMonitorService(repository, key);
			const invalid = {
				...request,
				alertCondition: {
					...request.alertCondition,
					conditions: [{ ...request.alertCondition.conditions[0]!, value }],
				},
			};
			for (const action of [
				service.createLedgerAccountBalanceMonitor(scope, invalid),
				service.updateLedgerAccountBalanceMonitor(scope, record.id.toString(), invalid),
			]) {
				expect(await Effect.runPromise(Effect.flip(action))).toMatchObject({ statusCode: 400 });
			}
			expect(repository.createMonitor).not.toHaveBeenCalled();
			expect(repository.updateMonitor).not.toHaveBeenCalled();
		}
	);
	it.each(["9223372036854775807", "-9223372036854775808"])(
		"accepts int64 threshold %s",
		async value => {
			const repository = repo();
			const service = new LedgerAccountBalanceMonitorService(repository, key);
			const valid = {
				...request,
				alertCondition: {
					...request.alertCondition,
					conditions: [{ ...request.alertCondition.conditions[0]!, value }],
				},
			};
			expect(
				(await Effect.runPromise(service.createLedgerAccountBalanceMonitor(scope, valid))).toResponse()
					.alertCondition.conditions[0]!.value
			).toBe(value);
		}
	);
});
