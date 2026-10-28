import { Effect, Option } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerApi } from "@/api";
import { signJWT } from "@/auth";
import type { LedgerAccountID, LedgerID, OrgID } from "@/lib/ids";
import { makeTestWebHandler } from "@/server";
import type { LedgerAccountRow } from "@/db/schema";
import { AccountHasDependents, AccountNotFound } from "./AccountErrors";
import type { AccountService } from "./AccountService";
import { LedgerAccount } from "./LedgerAccount";

const organizationId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const accountId = new TypeID("lat") as LedgerAccountID;
const asset = { assetId: new TypeID("ast").toString(), assetCode: "USD", minorUnitExponent: 2 };
const accountRow: LedgerAccountRow = {
	id: accountId.toUUID(),
	organizationId: organizationId.toUUID(),
	ledgerId: ledgerId.toUUID(),
	name: "Cash",
	description: "Operating cash",
	normalBalance: "debit",
	assetId: TypeID.fromString(asset.assetId).toUUID(),
	pendingAmount: -5n,
	postedAmount: 20n,
	availableAmount: 15n,
	pendingCredits: 10n,
	pendingDebits: 5n,
	postedCredits: 5n,
	postedDebits: 25n,
	availableCredits: 10n,
	availableDebits: 25n,
	lockVersion: 1,
	metadata: JSON.stringify({ externalId: "cash-42" }),
	created: new Date("2026-08-09T10:00:00.000Z"),
	updated: new Date("2026-08-09T11:00:00.000Z"),
};
const account = Option.getOrThrow(Effect.runSync(LedgerAccount.fromRow(accountRow, asset)));

const creditNormalAccount = Option.getOrThrow(
	Effect.runSync(
		LedgerAccount.fromRow(
			{
				...accountRow,
				normalBalance: "credit",
				pendingAmount: -15n,
				postedAmount: -20n,
				availableAmount: -10n,
				pendingCredits: 5n,
				pendingDebits: 20n,
				postedCredits: 10n,
				postedDebits: 30n,
				availableCredits: 10n,
				availableDebits: 20n,
			},
			asset
		)
	)
);

const service = (result = account): AccountService =>
	vi.mocked<AccountService>({
		listAccounts: vi.fn(() => Effect.succeed([result])),
		getAccount: vi.fn(() => Effect.succeed(result)),
		createAccount: vi.fn(() => Effect.succeed(result)),
		updateAccount: vi.fn(() => Effect.succeed(result)),
		deleteAccount: vi.fn(() => Effect.void),
	} as unknown as AccountService);

const disposers: Array<() => Promise<void>> = [];

const build = (implementation: AccountService) => {
	const { handler, dispose } = makeTestWebHandler({ account: implementation });
	disposers.push(dispose);
	return handler;
};

const tokenWith = (scope: Parameters<typeof signJWT>[0]["scope"]) =>
	signJWT({ sub: organizationId.toString(), scope });
const allPermissions = () => tokenWith(["super_admin"]);
const request = (
	method: string,
	path: string,
	options: { token?: string; anonymous?: boolean; body?: unknown } = {}
) => {
	const token = options.anonymous === true ? undefined : (options.token ?? allPermissions());
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
			...(options.body === undefined ? {} : { "content-type": "application/json" }),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
};

afterEach(async () => {
	for (const dispose of disposers.splice(0)) await dispose();
});

const collectionPath = `/api/ledgers/${ledgerId.toString()}/accounts`;
const itemPath = `${collectionPath}/${accountId.toString()}`;
const createBody = { name: "Cash", normalBalance: "debit", assetCode: "USD" };
const routes: Array<[string, string, string, unknown]> = [
	["GET", collectionPath, "ledger:account:read", undefined],
	["GET", itemPath, "ledger:account:read", undefined],
	["POST", collectionPath, "ledger:account:write", createBody],
	["PUT", itemPath, "ledger:account:write", { name: "Operating Cash" }],
	["DELETE", itemPath, "ledger:account:delete", undefined],
];

describe("AccountRoutes", () => {
	it("returns Account-owned Asset once and forwards list pagination", async () => {
		const implementation = service();
		const handler = build(implementation);
		const response = await handler(request("GET", `${collectionPath}?offset=10&limit=5`));

		expect(response.status).toBe(200);
		const text = await response.text();
		expect(JSON.parse(text)).toMatchObject([
			{
				id: accountId.toString(),
				ledgerId: ledgerId.toString(),
				assetId: asset.assetId,
				balances: [
					{ balanceType: "pending", amount: "-5", credits: "10", debits: "5" },
					{ balanceType: "posted", amount: "20", credits: "5", debits: "25" },
					{ balanceType: "availableBalance", amount: "15", credits: "10", debits: "25" },
				],
				created: "2026-08-09T10:00:00.000Z",
				updated: "2026-08-09T11:00:00.000Z",
			},
		]);
		expect(text).not.toContain('"currency":');
		expect(implementation.listAccounts).toHaveBeenCalledWith(organizationId, ledgerId, {
			offset: 10,
			limit: 5,
		});
	});

	it("serializes stored credit-normal Balances", async () => {
		const handler = build(service(creditNormalAccount));
		const response = await handler(request("GET", itemPath));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			balances: [
				{ balanceType: "pending", amount: "-15", credits: "5", debits: "20" },
				{ balanceType: "posted", amount: "-20", credits: "10", debits: "30" },
				{ balanceType: "availableBalance", amount: "-10", credits: "10", debits: "20" },
			],
		});
	});

	it("requires create-only fields and returns 201 with Location", async () => {
		const implementation = service();
		const handler = build(implementation);
		const response = await handler(
			request("POST", collectionPath, {
				body: { name: "Cash", normalBalance: "debit", assetCode: "US0378331005", ignored: true },
			})
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("location")).toBe(itemPath);
		expect(implementation.createAccount).toHaveBeenCalledWith(organizationId, ledgerId, {
			name: "Cash",
			normalBalance: "debit",
			assetCode: "US0378331005",
		});

		const invalid = await handler(request("POST", collectionPath, { body: { name: "Cash" } }));
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
	});

	it.each([{ assetId: asset.assetId }, { assetCode: "usd" }])(
		"accepts one Asset selector %j",
		async selector => {
			const implementation = service();
			const handler = build(implementation);
			const response = await handler(
				request("POST", collectionPath, {
					body: { name: "Cash", normalBalance: "debit", ...selector },
				})
			);
			expect(response.status).toBe(201);
			expect(implementation.createAccount).toHaveBeenCalledWith(organizationId, ledgerId, {
				name: "Cash",
				normalBalance: "debit",
				...selector,
			});
		}
	);

	it.each([{}, { assetId: asset.assetId, assetCode: "USD" }])(
		"rejects ambiguous or missing selector %j",
		async selector => {
			const implementation = service();
			const handler = build(implementation);
			const response = await handler(
				request("POST", collectionPath, {
					body: { name: "Cash", normalBalance: "debit", ...selector },
				})
			);
			expect(response.status).toBe(400);
			expect(implementation.createAccount).not.toHaveBeenCalled();
		}
	);

	it("strips immutable update fields", async () => {
		const implementation = service();
		const handler = build(implementation);
		const response = await handler(
			request("PUT", itemPath, {
				body: { name: "Operating Cash", normalBalance: "credit", assetCode: "EUR" },
			})
		);

		expect(response.status).toBe(200);
		expect(implementation.updateAccount).toHaveBeenCalledWith(organizationId, ledgerId, accountId, {
			name: "Operating Cash",
		});
	});

	it("deletes with an empty 204", async () => {
		const implementation = service();
		const handler = build(implementation);
		const response = await handler(request("DELETE", itemPath));

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
		expect(implementation.deleteAccount).toHaveBeenCalledWith(organizationId, ledgerId, accountId);
	});

	it("rejects malformed IDs before invoking the service", async () => {
		const implementation = service();
		const handler = build(implementation);
		const response = await handler(
			request("GET", "/api/ledgers/not-a-ledger/accounts/not-an-account")
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ type: "BAD_REQUEST", status: 400 });
		expect(implementation.getAccount).not.toHaveBeenCalled();
	});

	it("maps typed not-found and dependency failures", async () => {
		const implementation = service();
		vi.mocked(implementation.getAccount).mockReturnValue(Effect.fail(new AccountNotFound()));
		vi.mocked(implementation.deleteAccount).mockReturnValue(Effect.fail(new AccountHasDependents()));
		const handler = build(implementation);

		const get = await handler(request("GET", itemPath));
		const remove = await handler(request("DELETE", itemPath));
		expect(get.status).toBe(404);
		expect(remove.status).toBe(409);
	});

	describe("authentication", () => {
		it("returns 401 Invalid token without a token", async () => {
			const implementation = service();
			const handler = build(implementation);

			const response = await handler(request("GET", collectionPath, { anonymous: true }));

			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({
				type: "UNAUTHORIZED",
				status: 401,
				detail: "Invalid token",
			});
			expect(implementation.listAccounts).not.toHaveBeenCalled();
		});
	});

	describe("authorization", () => {
		it.each(routes)(
			"returns 403 on %s %s for a token without scope",
			async (method, path, permission, body) => {
				const implementation = service();
				const handler = build(implementation);

				const response = await handler(request(method, path, { token: tokenWith([]), body }));

				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({
					type: "FORBIDDEN",
					detail: `One of: ${permission}; permissions is required`,
				});
				for (const method of Object.values(implementation)) expect(method).not.toHaveBeenCalled();
			}
		);
	});

	describe("OpenAPI", () => {
		const spec = OpenApi.fromApi(LedgerApi);
		const groupOperations = (...ids: string[]) =>
			Object.values(spec.paths)
				.flatMap(path => Object.values(path ?? {}))
				.filter(operation =>
					ids.includes(String((operation as { operationId?: unknown }).operationId))
				);
		const operations = (path: string) =>
			spec.paths[path] as unknown as Record<
				string,
				{
					operationId: string;
					responses: object;
					parameters?: Array<{ name: string; in: string; required: boolean }>;
				}
			>;

		it("advertises operation-specific failures without 429", () => {
			const statuses = (path: string, method: string) =>
				Object.keys(operations(path)[method].responses);

			expect(statuses("/api/ledgers/{ledgerId}/accounts/", "post")).toEqual(
				expect.arrayContaining(["201", "404", "409"])
			);
			expect(statuses("/api/ledgers/{ledgerId}/accounts/{accountId}", "delete")).toEqual(
				expect.arrayContaining(["204", "409"])
			);
			expect(statuses("/api/ledgers/{ledgerId}/accounts/{accountId}", "get")).not.toContain("409");
			const own = groupOperations(
				"listLedgerAccounts",
				"getLedgerAccount",
				"createLedgerAccount",
				"updateLedgerAccount",
				"deleteLedgerAccount"
			);
			expect(own).toHaveLength(5);
			expect(JSON.stringify(own)).not.toContain('"429"');
		});

		it("documents the list offset and limit as optional", () => {
			const list = operations("/api/ledgers/{ledgerId}/accounts/").get;
			expect(list.operationId).toBe("listLedgerAccounts");
			for (const name of ["offset", "limit"]) {
				expect(list.parameters?.find(entry => entry.name === name)).toMatchObject({
					in: "query",
					required: false,
				});
			}
		});
	});
});
