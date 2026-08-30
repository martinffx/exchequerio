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
		expect(record.organizationId).toBe(organizationId.toString());
		expect(restored.toResponse()).not.toHaveProperty("organizationId");
	});
});
