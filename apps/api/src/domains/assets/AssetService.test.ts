import { Effect } from "effect";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { newOrgID } from "@/lib/ids";
import { NotFoundError } from "@/lib/errors";
import { Asset } from "./Asset";
import { AssetService } from "./AssetService";
import { AssetRepo } from "./AssetRepo";

const usd = { assetId: "ast_01h2x3y4z5a6b7c8d9e0f1g2h4", assetCode: "USD", minorUnitExponent: 2 };

describe("Asset construction", () => {
	it("constructs domain fields when the create effect executes", async () => {
		const orgId = newOrgID();
		const repository = Object.create(AssetRepo.prototype) as AssetRepo;
		const createAsset = vi
			.spyOn(repository, "createAsset")
			.mockImplementation(asset => Effect.succeed(asset));
		const service = new AssetService(repository);
		const effect = service.createAsset(orgId, {
			code: "usd",
			name: "Dollar",
			minorUnitExponent: 2,
			metadata: { source: "manual" },
		});

		expect(createAsset).not.toHaveBeenCalled();
		const asset = await Effect.runPromise(effect);
		expect(asset.id).toBeInstanceOf(TypeID);
		expect(asset.organizationId).toBe(orgId);
		expect(asset.code).toBe("USD");
		expect(asset.name).toBe("Dollar");
		expect(asset.minorUnitExponent).toBe(2);
		expect(asset.metadata).toEqual({ source: "manual" });
		expect(DateTime.isDateTime(asset.created)).toBe(true);
		expect(asset.created.zoneName).toBe("UTC");
		expect(asset.updated).toEqual(asset.created);
	});
});

describe("Asset lookup", () => {
	it.each([
		{
			reference: TypeID.fromString(usd.assetId, "ast"),
			expected: TypeID.fromString(usd.assetId, "ast"),
		},
		{ reference: "usd", expected: "USD" },
	])("looks up $reference within the Organization", async ({ reference, expected }) => {
		const orgId = newOrgID();
		const asset = Asset.fromRequest(
			TypeID.fromString(usd.assetId, "ast"),
			orgId,
			{ code: "USD", name: "Dollar", minorUnitExponent: 2 },
			DateTime.utc()
		);
		const repository = Object.create(AssetRepo.prototype) as AssetRepo;
		const getAsset = vi.spyOn(repository, "getAsset").mockReturnValue(Effect.succeed(asset));
		const result = await Effect.runPromise(new AssetService(repository).getAsset(orgId, reference));
		expect(result).toBe(asset);
		expect(getAsset).toHaveBeenCalledExactlyOnceWith(orgId, expected);
	});

	it("preserves missing-Asset failures", async () => {
		const repository = Object.create(AssetRepo.prototype) as AssetRepo;
		const failure = new NotFoundError("Asset not found");
		vi.spyOn(repository, "getAsset").mockReturnValue(Effect.fail(failure));
		const error = await Effect.runPromise(
			Effect.flip(new AssetService(repository).getAsset(newOrgID(), "EUR"))
		);
		expect(error).toBe(failure);
	});
});
