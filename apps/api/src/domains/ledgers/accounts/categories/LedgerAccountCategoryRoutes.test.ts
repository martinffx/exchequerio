import { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { LedgerApi } from "@/api";
import { LedgerNotFound } from "@/domains/ledgers/LedgerErrors";
import type { AccountService } from "@/domains/ledgers/accounts/AccountService";
import { LedgerAccountCategoryEntity } from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryEntity";
import {
	CategoryConflict,
	CategoryPersistenceFailure,
	CategoryRepositoryUnavailable,
} from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryErrors";
import type { LedgerAccountCategoryService } from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryService";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { makeRequest, tokenFor, useTestWebHandlers } from "@/lib/testing";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID, OrgID } from "@/lib/ids";
import { createLedgerAccountCategoryFixture } from "./fixtures";
import type { LedgerAccountCategoryResponse } from "./LedgerAccountCategorySchema";

const ledgerId = new TypeID("lgr") as LedgerID;
const ledgerIdStr = ledgerId.toString();
const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
const categoryIdStr = categoryId.toString();
const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
const accountId = new TypeID("lat") as LedgerAccountID;
const orgId = TypeID.fromString<"org">("org_01h2x9z3y5k8m6n4p0q1r2s3t4") as OrgID;
const mockCategory = createLedgerAccountCategoryFixture({ ledgerId, id: categoryId });

const base = `/api/ledgers/${ledgerIdStr}/accounts/categories`;
const item = `${base}/${categoryIdStr}`;
const accountLink = `${item}/accounts/${accountId.toString()}`;
const categoryLink = `${item}/categories/${parentCategoryId.toString()}`;
const payload = { name: "Assets", normalBalance: "debit" };

const service = (): LedgerAccountCategoryService =>
	vi.mocked<LedgerAccountCategoryService>({
		listLedgerAccountCategories: vi.fn(() => Effect.succeed([mockCategory])),
		getLedgerAccountCategoryBalances: vi.fn(),
		getLedgerAccountCategory: vi.fn(() => Effect.succeed(mockCategory)),
		createLedgerAccountCategory: vi.fn(() => Effect.succeed(mockCategory)),
		updateLedgerAccountCategory: vi.fn(() => Effect.succeed(mockCategory)),
		deleteLedgerAccountCategory: vi.fn(() => Effect.void),
		linkLedgerAccountToCategory: vi.fn(() => Effect.void),
		unlinkLedgerAccountToCategory: vi.fn(() => Effect.void),
		linkLedgerAccountCategoryToCategory: vi.fn(() => Effect.void),
		unlinkLedgerAccountCategoryToCategory: vi.fn(() => Effect.void),
	} as unknown as LedgerAccountCategoryService);

const buildHandler = useTestWebHandlers();
const build = (
	implementation: LedgerAccountCategoryService,
	extra: { account?: AccountService } = {}
) => {
	return buildHandler({ category: implementation, ...extra });
};
const tokenWith = tokenFor(orgId);
const request = makeRequest(() => tokenWith(["super_admin"]));
const json = async <T = unknown>(response: Response) => (await response.json()) as T;

const routes: Array<[string, string, string, unknown]> = [
	["GET", `${item}/balances`, "ledger:account:category:read", undefined],
	["GET", base, "ledger:account:category:read", undefined],
	["GET", item, "ledger:account:category:read", undefined],
	["POST", base, "ledger:account:category:write", payload],
	["PUT", item, "ledger:account:category:write", payload],
	["DELETE", item, "ledger:account:category:delete", undefined],
	["PATCH", accountLink, "ledger:account:category:write", undefined],
	["DELETE", accountLink, "ledger:account:category:write", undefined],
	["PATCH", categoryLink, "ledger:account:category:write", undefined],
	["DELETE", categoryLink, "ledger:account:category:write", undefined],
];

const accountService = () =>
	({ getAccount: vi.fn(), listAccounts: vi.fn() }) as unknown as AccountService;

describe("Category routes", () => {
	it.each(["POST", "PUT"] as const)(
		"preserves %s metadata through the request and response",
		async method => {
			const metadata = { purpose: "position", empty: "" };
			const category = createLedgerAccountCategoryFixture({ ledgerId, id: categoryId, metadata });
			const implementation = service();
			const stub =
				method === "POST"
					? vi.mocked(implementation.createLedgerAccountCategory)
					: vi.mocked(implementation.updateLedgerAccountCategory);
			stub.mockReturnValue(Effect.succeed(category));
			const response = await build(implementation)(
				request(method, method === "PUT" ? item : base, {
					body: { name: "Assets", normalBalance: "debit", metadata },
				})
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("location")).toBeNull();
			expect(stub.mock.calls[0]?.at(-1)).toMatchObject({ metadata });
			expect(await json(response)).toMatchObject({ metadata });
		}
	);

	it.each(["POST", "PUT"] as const)(
		"rejects %s non-string metadata before service execution",
		async method => {
			const implementation = service();
			const handler = build(implementation);
			// oxlint-disable-next-line unicorn/no-null -- JSON null must be rejected as a metadata value.
			for (const value of [12, true, null, { nested: "value" }, ["value"]]) {
				const response = await handler(
					request(method, method === "PUT" ? item : base, {
						body: { name: "Assets", normalBalance: "debit", metadata: { invalid: value } },
					})
				);
				expect(response.status).toBe(400);
				expect(await json(response)).toMatchObject({ type: "BAD_REQUEST", status: 400 });
			}
			expect(implementation.createLedgerAccountCategory).not.toHaveBeenCalled();
			expect(implementation.updateLedgerAccountCategory).not.toHaveBeenCalled();
		}
	);

	it("serializes Asset balances and preserves decimal-string precision", async () => {
		const body = LedgerAccountCategoryEntity.balancesFromRecord({
			id: categoryId.toUUID(),
			normalBalance: "credit",
			assets: [
				{
					id: new TypeID("ast").toUUID(),
					code: "USD",
					minorUnitExponent: 2,
					postedCredits: "9007199254740993",
					pendingCredits: "9007199254740993",
					postedDebits: "0",
					pendingDebits: "0",
				},
			],
		});
		const implementation = service();
		vi.mocked(implementation.getLedgerAccountCategoryBalances).mockReturnValue(Effect.succeed(body));
		const response = await build(implementation)(request("GET", `${item}/balances`));
		expect(response.status).toBe(200);
		expect(await json(response)).toEqual(body.toResponse());
		expect(implementation.getLedgerAccountCategoryBalances).toHaveBeenCalledWith(
			orgId,
			ledgerId,
			categoryId
		);
	});

	it.each([
		new ConflictError("Accounting projection exceeds the signed 64-bit range", { retryable: false }),
		new NotFoundError("Category not found"),
		new CategoryRepositoryUnavailable(new Error("offline")),
		new CategoryPersistenceFailure(new Error("query failed")),
	])("maps balance errors through the existing HTTP handler", async error => {
		const implementation = service();
		vi.mocked(implementation.getLedgerAccountCategoryBalances).mockReturnValue(Effect.fail(error));
		const response = await build(implementation)(request("GET", `${item}/balances`));
		expect(response.status).toBe(error.statusCode);
		const body = await json<{ detail: string; retryable?: boolean }>(response);
		expect(body.detail).toBe(error.message);
		if (error instanceof ConflictError) expect(body.retryable).toBe(false);
	});

	it.each([
		['{"period":"monthly"}', { period: "monthly" }],
		["{}", {}],
		['{"period":"monthly","count":1}', undefined],
		['{"nested":{"toString":null}}', undefined],
		['["monthly"]', undefined],
		['"monthly"', undefined],
		["1", undefined],
		["true", undefined],
		["null", undefined],
		["not-json", undefined],
	])("safely returns stored metadata %s on GET and list", async (metadata, expected) => {
		const category = LedgerAccountCategoryEntity.fromRecord({
			...mockCategory,
			id: categoryId.toUUID(),
			organizationId: mockCategory.organizationId.toUUID(),
			ledgerId: ledgerId.toUUID(),
			description: "Historical category",
			// oxlint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			parentCategoryId: null,
			metadata,
		});
		const implementation = service();
		vi.mocked(implementation.getLedgerAccountCategory).mockReturnValue(Effect.succeed(category));
		vi.mocked(implementation.listLedgerAccountCategories).mockReturnValue(Effect.succeed([category]));
		const handler = build(implementation);
		const [get, list] = await Promise.all([
			handler(request("GET", item)),
			handler(request("GET", base)),
		]);
		expect(get.status).toBe(200);
		expect(list.status).toBe(200);
		for (const body of [
			await json<LedgerAccountCategoryResponse>(get),
			(await json<LedgerAccountCategoryResponse[]>(list))[0],
		]) {
			expect(body.id).toBe(categoryIdStr);
			if (expected === undefined) expect(body).not.toHaveProperty("metadata");
			else expect(body.metadata).toEqual(expected);
		}
	});

	describe("routing", () => {
		it("sends the static categories segment to the Category list, not the Account route", async () => {
			const implementation = service();
			const accounts = accountService();
			const response = await build(implementation, { account: accounts })(request("GET", base));
			expect(response.status).toBe(200);
			expect(implementation.listLedgerAccountCategories).toHaveBeenCalledTimes(1);
			expect(accounts.getAccount).not.toHaveBeenCalled();
			// The trailing slash form is the same collection.
			const slash = await build(implementation, { account: accountService() })(
				request("GET", `${base}/`)
			);
			expect(slash.status).toBe(200);
			expect(implementation.listLedgerAccountCategories).toHaveBeenCalledTimes(2);
		});

		it("sends a Category id under the static segment to getLedgerAccountCategory", async () => {
			const implementation = service();
			const accounts = accountService();
			const response = await build(implementation, { account: accounts })(request("GET", item));
			expect(response.status).toBe(200);
			expect(implementation.getLedgerAccountCategory).toHaveBeenCalledTimes(1);
			expect(accounts.getAccount).not.toHaveBeenCalled();
		});

		it("still sends an Account id to getLedgerAccount", async () => {
			const implementation = service();
			const accounts = accountService();
			vi
				.mocked(accounts.getAccount)
				.mockReturnValue(Effect.fail(new NotFoundError("Account not found")));
			const response = await build(implementation, { account: accounts })(
				request("GET", `/api/ledgers/${ledgerIdStr}/accounts/${accountId.toString()}`)
			);
			expect(response.status).toBe(404);
			expect(accounts.getAccount).toHaveBeenCalledTimes(1);
			expect(implementation.getLedgerAccountCategory).not.toHaveBeenCalled();
			expect(implementation.listLedgerAccountCategories).not.toHaveBeenCalled();
		});
	});

	describe("List Ledger Account Categories", () => {
		it("returns a list of categories with default pagination", async () => {
			const implementation = service();
			const response = await build(implementation)(request("GET", base));
			expect(response.status).toBe(200);
			expect(await json(response)).toEqual([mockCategory.toResponse()]);
			expect(implementation.listLedgerAccountCategories).toHaveBeenCalledWith(orgId, ledgerId, 0, 20);
		});

		it("forwards pagination", async () => {
			const implementation = service();
			const response = await build(implementation)(request("GET", `${base}?offset=10&limit=5`));
			expect(response.status).toBe(200);
			expect(implementation.listLedgerAccountCategories).toHaveBeenCalledWith(orgId, ledgerId, 10, 5);
		});

		it("returns service unavailable when the Category repository is unavailable", async () => {
			const implementation = service();
			vi
				.mocked(implementation.listLedgerAccountCategories)
				.mockReturnValue(
					Effect.fail(new CategoryRepositoryUnavailable(new Error("connect ECONNREFUSED")))
				);
			const response = await build(implementation)(request("GET", base));
			expect(response.status).toBe(503);
			expect(await json(response)).toMatchObject({ status: 503 });
		});

		it("returns an internal server error for a typed Category persistence failure", async () => {
			const implementation = service();
			vi
				.mocked(implementation.listLedgerAccountCategories)
				.mockReturnValue(
					Effect.fail(new CategoryPersistenceFailure(new Error("unexpected database failure")))
				);
			const response = await build(implementation)(request("GET", base));
			expect(response.status).toBe(500);
			expect(await json(response)).toMatchObject({ status: 500 });
		});

		it("returns 404 when the Ledger is not owned by the token Organization", async () => {
			const implementation = service();
			vi
				.mocked(implementation.listLedgerAccountCategories)
				.mockReturnValue(Effect.fail(new LedgerNotFound()));
			const response = await build(implementation)(request("GET", base));
			expect(response.status).toBe(404);
		});

		it("handles bad request error", async () => {
			const implementation = service();
			const response = await build(implementation)(request("GET", `${base}?offset=invalid`));
			expect(response.status).toBe(400);
			expect(await json(response)).toMatchObject({ type: "BAD_REQUEST", status: 400 });
			expect(implementation.listLedgerAccountCategories).not.toHaveBeenCalled();
		});

		it.each(["offset=NaN", "limit=Infinity"])("rejects non-finite pagination %s", async query => {
			const implementation = service();
			const response = await build(implementation)(request("GET", `${base}?${query}`));
			expect(response.status).toBe(400);
			expect(await json(response)).toMatchObject({ type: "BAD_REQUEST", status: 400 });
			expect(implementation.listLedgerAccountCategories).not.toHaveBeenCalled();
		});

		it("returns 401 for an invalid token", async () => {
			const response = await build(service())(request("GET", base, { token: "invalid_token" }));
			expect(response.status).toBe(401);
			expect(await json(response)).toMatchObject({ type: "UNAUTHORIZED", status: 401 });
		});
	});

	describe("Get Ledger Account Category", () => {
		it("returns a category", async () => {
			const implementation = service();
			const response = await build(implementation)(request("GET", item));
			expect(response.status).toBe(200);
			expect(await json(response)).toEqual(mockCategory.toResponse());
			expect(implementation.getLedgerAccountCategory).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				categoryId
			);
		});

		it("handles not found error", async () => {
			const implementation = service();
			vi
				.mocked(implementation.getLedgerAccountCategory)
				.mockReturnValue(Effect.fail(new NotFoundError("Category not found")));
			const response = await build(implementation)(request("GET", item));
			expect(response.status).toBe(404);
			expect(await json(response)).toMatchObject({ status: 404, detail: "Category not found" });
		});

		it("handles bad request error", async () => {
			const implementation = service();
			const response = await build(implementation)(request("GET", `${base}/invalid`));
			expect(response.status).toBe(400);
			expect(await json(response)).toMatchObject({ type: "BAD_REQUEST", status: 400 });
			expect(implementation.getLedgerAccountCategory).not.toHaveBeenCalled();
		});

		it("returns 401 for an invalid token", async () => {
			const response = await build(service())(request("GET", item, { token: "invalid_token" }));
			expect(response.status).toBe(401);
			expect(await json(response)).toMatchObject({ status: 401 });
		});
	});

	describe("Create Ledger Account Category", () => {
		it("creates a category and answers 200 without a Location", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("POST", base, {
					body: { name: "Assets", description: "Asset accounts", normalBalance: "debit" },
				})
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("location")).toBeNull();
			expect(await json(response)).toEqual(mockCategory.toResponse());
			expect(implementation.createLedgerAccountCategory).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				expect.objectContaining({
					name: "Assets",
					description: "Asset accounts",
					normalBalance: "debit",
				})
			);
		});

		it("returns 404 when the Ledger is not owned by the token Organization", async () => {
			const implementation = service();
			vi
				.mocked(implementation.createLedgerAccountCategory)
				.mockReturnValue(Effect.fail(new LedgerNotFound()));
			const response = await build(implementation)(request("POST", base, { body: payload }));
			expect(response.status).toBe(404);
		});

		it("handles bad request error", async () => {
			const implementation = service();
			// Missing normalBalance
			const response = await build(implementation)(
				request("POST", base, { body: { name: "Assets" } })
			);
			expect(response.status).toBe(400);
			expect(await json(response)).toMatchObject({ type: "BAD_REQUEST", status: 400 });
			expect(implementation.createLedgerAccountCategory).not.toHaveBeenCalled();
		});

		it("handles conflict error", async () => {
			const implementation = service();
			vi
				.mocked(implementation.createLedgerAccountCategory)
				.mockReturnValue(Effect.fail(new ConflictError("Category already exists")));
			const response = await build(implementation)(request("POST", base, { body: payload }));
			expect(response.status).toBe(409);
			expect(await json(response)).toMatchObject({ status: 409, detail: "Category already exists" });
		});

		it("returns 401 for an invalid token", async () => {
			const response = await build(service())(
				request("POST", base, { token: "invalid_token", body: payload })
			);
			expect(response.status).toBe(401);
		});

		it("returns 403 for a read-only token", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("POST", base, { token: tokenWith(["org_readonly"]), body: payload })
			);
			expect(response.status).toBe(403);
			expect(await json(response)).toMatchObject({ type: "FORBIDDEN", status: 403 });
			expect(implementation.createLedgerAccountCategory).not.toHaveBeenCalled();
		});
	});

	describe("Update Ledger Account Category", () => {
		it("updates a category", async () => {
			const updated = createLedgerAccountCategoryFixture({
				ledgerId,
				id: categoryId,
				name: "Updated Assets",
			});
			const implementation = service();
			vi.mocked(implementation.updateLedgerAccountCategory).mockReturnValue(Effect.succeed(updated));
			const response = await build(implementation)(
				request("PUT", item, {
					body: {
						name: "Updated Assets",
						description: "Updated description",
						normalBalance: "debit",
					},
				})
			);
			expect(response.status).toBe(200);
			expect(await json(response)).toEqual(updated.toResponse());
			expect(implementation.updateLedgerAccountCategory).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				categoryId,
				expect.objectContaining({
					name: "Updated Assets",
					description: "Updated description",
					normalBalance: "debit",
				})
			);
		});

		it("handles not found error", async () => {
			const implementation = service();
			vi
				.mocked(implementation.updateLedgerAccountCategory)
				.mockReturnValue(Effect.fail(new NotFoundError("Category not found")));
			const response = await build(implementation)(request("PUT", item, { body: payload }));
			expect(response.status).toBe(404);
			expect(await json(response)).toMatchObject({ status: 404 });
		});

		it("returns 401 for an invalid token", async () => {
			const response = await build(service())(
				request("PUT", item, { token: "invalid_token", body: payload })
			);
			expect(response.status).toBe(401);
		});

		it("returns 403 for a read-only token", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("PUT", item, { token: tokenWith(["org_readonly"]), body: payload })
			);
			expect(response.status).toBe(403);
			expect(implementation.updateLedgerAccountCategory).not.toHaveBeenCalled();
		});
	});

	describe("Delete Ledger Account Category", () => {
		it("deletes a category with an empty 200", async () => {
			const implementation = service();
			const response = await build(implementation)(request("DELETE", item));
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("");
			expect(implementation.deleteLedgerAccountCategory).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				categoryId
			);
		});

		it("handles not found error", async () => {
			const implementation = service();
			vi
				.mocked(implementation.deleteLedgerAccountCategory)
				.mockReturnValue(Effect.fail(new NotFoundError("Category not found")));
			const response = await build(implementation)(request("DELETE", item));
			expect(response.status).toBe(404);
			expect(await json(response)).toMatchObject({ status: 404 });
		});

		it("returns 401 for an invalid token", async () => {
			const response = await build(service())(request("DELETE", item, { token: "invalid_token" }));
			expect(response.status).toBe(401);
		});

		it("returns 403 for a read-only token", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("DELETE", item, { token: tokenWith(["org_readonly"]) })
			);
			expect(response.status).toBe(403);
			expect(implementation.deleteLedgerAccountCategory).not.toHaveBeenCalled();
		});
	});

	describe("Link Ledger Account to Category", () => {
		it("links an account with an empty 200", async () => {
			const implementation = service();
			const response = await build(implementation)(request("PATCH", accountLink));
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("");
			expect(implementation.linkLedgerAccountToCategory).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				categoryId,
				accountId
			);
		});

		it("handles not found error", async () => {
			const implementation = service();
			vi
				.mocked(implementation.linkLedgerAccountToCategory)
				.mockReturnValue(Effect.fail(new NotFoundError("Account not found")));
			const response = await build(implementation)(request("PATCH", accountLink));
			expect(response.status).toBe(404);
			expect(await json(response)).toMatchObject({ status: 404 });
		});

		it("handles bad request error", async () => {
			const implementation = service();
			const response = await build(implementation)(request("PATCH", `${item}/accounts/invalid`));
			expect(response.status).toBe(400);
			expect(await json(response)).toMatchObject({ type: "BAD_REQUEST", status: 400 });
			expect(implementation.linkLedgerAccountToCategory).not.toHaveBeenCalled();
		});

		it("returns 401 for an invalid token", async () => {
			const response = await build(service())(
				request("PATCH", accountLink, { token: "invalid_token" })
			);
			expect(response.status).toBe(401);
		});

		it("returns 403 for a read-only token", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("PATCH", accountLink, { token: tokenWith(["org_readonly"]) })
			);
			expect(response.status).toBe(403);
			expect(implementation.linkLedgerAccountToCategory).not.toHaveBeenCalled();
		});
	});

	describe("Unlink Ledger Account from Category", () => {
		it("unlinks an account with an empty 200", async () => {
			const implementation = service();
			const response = await build(implementation)(request("DELETE", accountLink));
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("");
			expect(implementation.unlinkLedgerAccountToCategory).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				categoryId,
				accountId
			);
		});

		it("handles not found error", async () => {
			const implementation = service();
			vi
				.mocked(implementation.unlinkLedgerAccountToCategory)
				.mockReturnValue(Effect.fail(new NotFoundError("Link not found")));
			const response = await build(implementation)(request("DELETE", accountLink));
			expect(response.status).toBe(404);
			expect(await json(response)).toMatchObject({ status: 404 });
		});

		it("returns 401 for an invalid token", async () => {
			const response = await build(service())(
				request("DELETE", accountLink, { token: "invalid_token" })
			);
			expect(response.status).toBe(401);
		});

		it("returns 403 for a read-only token", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("DELETE", accountLink, { token: tokenWith(["org_readonly"]) })
			);
			expect(response.status).toBe(403);
			expect(implementation.unlinkLedgerAccountToCategory).not.toHaveBeenCalled();
		});
	});

	describe("Link Ledger Account Category to Category", () => {
		it.each([true, false])("serializes parent-link conflict retryable=%s", async retryable => {
			const message = retryable ? "Category hierarchy is busy" : "Category link would create a cycle";
			const implementation = service();
			vi
				.mocked(implementation.linkLedgerAccountCategoryToCategory)
				.mockReturnValue(Effect.fail(new CategoryConflict(message, { retryable })));
			const response = await build(implementation)(request("PATCH", categoryLink));
			expect(response.status).toBe(409);
			expect(await json(response)).toMatchObject({ detail: message, retryable });
		});

		it("links a category to a parent category with an empty 200", async () => {
			const implementation = service();
			const response = await build(implementation)(request("PATCH", categoryLink));
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("");
			expect(implementation.linkLedgerAccountCategoryToCategory).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				categoryId,
				parentCategoryId
			);
		});

		it("handles not found error", async () => {
			const implementation = service();
			vi
				.mocked(implementation.linkLedgerAccountCategoryToCategory)
				.mockReturnValue(Effect.fail(new NotFoundError("Parent category not found")));
			const response = await build(implementation)(request("PATCH", categoryLink));
			expect(response.status).toBe(404);
			expect(await json(response)).toMatchObject({ status: 404 });
		});

		it("returns 401 for an invalid token", async () => {
			const response = await build(service())(
				request("PATCH", categoryLink, { token: "invalid_token" })
			);
			expect(response.status).toBe(401);
		});

		it("returns 403 for a read-only token", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("PATCH", categoryLink, { token: tokenWith(["org_readonly"]) })
			);
			expect(response.status).toBe(403);
			expect(implementation.linkLedgerAccountCategoryToCategory).not.toHaveBeenCalled();
		});
	});

	describe("Unlink Ledger Account Category from Category", () => {
		it("unlinks a category from a parent category with an empty 200", async () => {
			const implementation = service();
			const response = await build(implementation)(request("DELETE", categoryLink));
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("");
			expect(implementation.unlinkLedgerAccountCategoryToCategory).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				categoryId,
				parentCategoryId
			);
		});

		it("handles not found error", async () => {
			const implementation = service();
			vi
				.mocked(implementation.unlinkLedgerAccountCategoryToCategory)
				.mockReturnValue(Effect.fail(new NotFoundError("Link not found")));
			const response = await build(implementation)(request("DELETE", categoryLink));
			expect(response.status).toBe(404);
			expect(await json(response)).toMatchObject({ status: 404 });
		});

		it("returns 401 for an invalid token", async () => {
			const response = await build(service())(
				request("DELETE", categoryLink, { token: "invalid_token" })
			);
			expect(response.status).toBe(401);
		});

		it("returns 403 for a read-only token", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("DELETE", categoryLink, { token: tokenWith(["org_readonly"]) })
			);
			expect(response.status).toBe(403);
			expect(implementation.unlinkLedgerAccountCategoryToCategory).not.toHaveBeenCalled();
		});
	});

	describe("authorization", () => {
		it("requires authentication on every route", async () => {
			for (const [method, path, , body] of routes) {
				const implementation = service();
				const response = await build(implementation)(request(method, path, { anonymous: true, body }));
				expect(response.status, `${method} ${path}`).toBe(401);
				expect(await json(response)).toMatchObject({ type: "UNAUTHORIZED", detail: "Invalid token" });
				for (const stub of Object.values(implementation)) expect(stub).not.toHaveBeenCalled();
			}
		});

		it.each(routes)(
			"returns 403 on %s %s for a token without scope",
			async (method, path, permission, body) => {
				const implementation = service();
				const response = await build(implementation)(
					request(method, path, { token: tokenWith([]), body })
				);
				expect(response.status).toBe(403);
				expect(await json(response)).toMatchObject({
					type: "FORBIDDEN",
					detail: `One of: ${permission}; permissions is required`,
				});
				for (const stub of Object.values(implementation)) expect(stub).not.toHaveBeenCalled();
			}
		);

		it("rejects a malformed id with 400 before the permission check", async () => {
			const implementation = service();
			const response = await build(implementation)(
				request("GET", `${base}/not-an-id`, { token: tokenWith([]) })
			);
			// The id pattern is validated before the permission check.
			expect(response.status).toBe(400);
			expect(implementation.getLedgerAccountCategory).not.toHaveBeenCalled();
		});
	});
});

type Operation = {
	operationId: string;
	tags?: string[];
	responses: Record<string, { headers?: object }>;
};

describe("LedgerAccountCategoryApi", () => {
	const spec = OpenApi.fromApi(LedgerApi);
	const paths = spec.paths;
	const prefix = "/api/ledgers/{ledgerId}/accounts/categories";
	const collection = paths[`${prefix}/`];
	const item = paths[`${prefix}/{categoryId}`];
	const account = paths[`${prefix}/{categoryId}/accounts/{accountId}`];
	const parent = paths[`${prefix}/{categoryId}/categories/{parentCategoryId}`];
	const operations = {
		balances: paths[`${prefix}/{categoryId}/balances`]?.get,
		list: collection?.get,
		create: collection?.post,
		get: item?.get,
		update: item?.put,
		delete: item?.delete,
		linkAccount: account?.patch,
		unlinkAccount: account?.delete,
		linkParent: parent?.patch,
		unlinkParent: parent?.delete,
	};

	it("documents all generated Category OpenAPI operations", () => {
		for (const operation of Object.values(operations)) expect(operation).toBeDefined();
		expect(operations).toMatchSnapshot();
	});

	it("locks the Category body schemas", () => {
		const { schemas } = spec.components;
		expect({
			LedgerAccountCategoryRequest: schemas.LedgerAccountCategoryRequest,
			LedgerAccountCategoryResponse: schemas.LedgerAccountCategoryResponse,
			LedgerAccountCategoryBalancesResponse: schemas.LedgerAccountCategoryBalancesResponse,
		}).toMatchSnapshot();
	});

	it("declares 429 on every operation and 409 only where the legacy routes did", () => {
		const conflictOperations = new Set([
			"balances",
			"create",
			"update",
			"delete",
			"linkAccount",
			"unlinkAccount",
			"linkParent",
			"unlinkParent",
		]);
		for (const [name, operation] of Object.entries(operations)) {
			const statuses = Object.keys((operation as unknown as Operation).responses);
			expect(statuses, name).toContain("429");
			expect(statuses.includes("409"), name).toBe(conflictOperations.has(name));
			expect(statuses, name).toContain("404");
		}
	});

	it("answers creates with 200 and no Location header", () => {
		const { responses } = operations.create as unknown as Operation;
		expect(Object.keys(responses)).toContain("200");
		expect(Object.keys(responses)).not.toContain("201");
		expect(responses["200"].headers).toBeUndefined();
	});

	it("tags every operation with the Category group", () => {
		for (const operation of Object.values(operations))
			expect((operation as unknown as Operation).tags).toEqual(["Ledger Account Categories"]);
	});
});
