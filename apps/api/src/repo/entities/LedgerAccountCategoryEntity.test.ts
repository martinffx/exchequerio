import { TypeID } from "typeid-js";
import type { LedgerAccountCategoryRequest } from "@/routes/ledgers/schema";
import type { LedgerID, OrgID } from "./types";
import { LedgerAccountCategoryEntity } from "./LedgerAccountCategoryEntity";

describe("LedgerAccountCategoryEntity ownership", () => {
	it("round trips Organization ownership without exposing it in the response", () => {
		const organizationId = new TypeID("org") as OrgID;
		const ledgerId = new TypeID("lgr") as LedgerID;
		const request: LedgerAccountCategoryRequest = {
			name: "Assets",
			description: "Asset accounts",
			normalBalance: "debit",
			metadata: { purpose: "position" },
		};

		const entity = LedgerAccountCategoryEntity.fromRequest(request, organizationId, ledgerId);
		const record = entity.toRecord();
		const restored = LedgerAccountCategoryEntity.fromRecord({
			...record,
			description: record.description as string,
			metadata: record.metadata as string,
			parentCategoryId: record.parentCategoryId as string | null,
			created: entity.created,
			updated: entity.updated,
		});

		expect(restored.organizationId).toEqual(organizationId);
		expect(restored.ledgerId).toEqual(ledgerId);
		expect(record.id).toBe(entity.id.toUUID());
		expect(record.organizationId).toBe(organizationId.toUUID());
		expect(record.ledgerId).toBe(ledgerId.toUUID());
		expect(restored.toResponse().id).toBe(entity.id.toString());
		expect(restored.toResponse()).not.toHaveProperty("organizationId");
	});
});

/* oxlint-disable unicorn/no-null -- Stored rows use SQL null for nullable columns. */
describe("LedgerAccountCategoryEntity stored metadata", () => {
	const record = {
		id: new TypeID("lac").toUUID(),
		organizationId: new TypeID("org").toUUID(),
		ledgerId: new TypeID("lgr").toUUID(),
		name: "Assets",
		description: null,
		normalBalance: "debit" as const,
		parentCategoryId: null,
		created: new Date(),
		updated: new Date(),
	};
	it.each([
		null,
		"",
		"broken",
		"null",
		"[]",
		'"text"',
		"12",
		'{"value":12}',
		'{"value":null}',
		'{"value":{}}',
	])("treats invalid stored metadata %s as absent", metadata => {
		expect(LedgerAccountCategoryEntity.fromRecord({ ...record, metadata }).metadata).toBeUndefined();
	});
	it.each([{}, { purpose: "position", empty: "" }])("preserves string maps %j", metadata => {
		expect(
			LedgerAccountCategoryEntity.fromRecord({ ...record, metadata: JSON.stringify(metadata) })
				.metadata
		).toEqual(metadata);
	});
	it.each(["created", "updated"] as const)("rejects invalid stored %s at row decoding", field => {
		for (const value of [new Date(Number.NaN), Infinity, "2026-01-01"]) {
			expect(() =>
				LedgerAccountCategoryEntity.fromRecord({ ...record, metadata: null, [field]: value as Date })
			).toThrow();
		}
	});
});
/* oxlint-enable unicorn/no-null */
