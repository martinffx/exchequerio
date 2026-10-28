import { OpenApi } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";
import { LedgerApi } from "@/api";

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
