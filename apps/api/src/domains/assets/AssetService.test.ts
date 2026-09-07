import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { newOrgID } from "@/lib/ids";
import { NotFoundError } from "@/lib/errors";
import { AssetService } from "./AssetService";
import { AssetRepo } from "./AssetRepo";

const usd = { assetId: "ast_01h2x3y4z5a6b7c8d9e0f1g2h4", assetCode: "USD", minorUnitExponent: 2 };

describe("Asset selector resolution", () => {
	it("batches distinct selectors and preserves order including equivalent code and ID", async () => {
		const orgId = newOrgID();
		const repository = Object.create(AssetRepo.prototype) as AssetRepo;
		const findAssets = vi.spyOn(repository, "findAssets").mockReturnValue(Effect.succeed([usd]));
		const service = new AssetService(repository);
		const result = await Effect.runPromise(
			service.resolveAssets(orgId, [
				{ assetCode: "usd" },
				{ assetId: usd.assetId },
				{ assetCode: "USD" },
			])
		);
		expect(result).toEqual([usd, usd, usd]);
		expect(findAssets).toHaveBeenCalledExactlyOnceWith(orgId, [usd.assetId], ["USD"]);
	});
	it("fails the entire resolution when any selector is absent", async () => {
		const repository = Object.create(AssetRepo.prototype) as AssetRepo;
		vi.spyOn(repository, "findAssets").mockReturnValue(Effect.succeed([usd]));
		const error = await Effect.runPromise(
			Effect.flip(
				new AssetService(repository).resolveAssets(newOrgID(), [
					{ assetCode: "USD" },
					{ assetCode: "EUR" },
				])
			)
		);
		expect(error).toBeInstanceOf(NotFoundError);
	});
});
