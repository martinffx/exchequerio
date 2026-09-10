import { TypeID } from "typeid-js";
import { DateTime } from "luxon";
import { encodeUuid } from "@/lib/utils";
import { Effect, Layer, ManagedRuntime } from "effect";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { DatabaseTag, makeDatabaseLive, type Database } from "@/db";
import { newOrgID, newLedgerID, newLedgerAccountID } from "@/lib/ids";
import { AssetsTable, OrganizationsTable, LedgersTable, LedgerAccountsTable } from "@/db/schema";
import { ConflictError, InternalServerError, NotFoundError } from "@/lib/errors";
import { assetRepoLayer } from "./AssetRepo";
import { AssetServiceTag, assetServiceLayer, type AssetService } from "./AssetService";

const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
const runtime = ManagedRuntime.make(
	assetServiceLayer.pipe(Layer.provide(assetRepoLayer), Layer.provideMerge(databaseLayer))
);
const orgId = newOrgID();
const otherOrgId = newOrgID();
let service: AssetService;
let database: Database;

beforeAll(async () => {
	service = await runtime.runPromise(AssetServiceTag);
	database = await runtime.runPromise(DatabaseTag);
	await database.db.insert(OrganizationsTable).values([
		{ id: orgId.toUUID(), name: "Asset tests" },
		{ id: otherOrgId.toUUID(), name: "Other Asset tests" },
	]);
});

afterAll(async () => {
	if (database) {
		for (const id of [orgId, otherOrgId]) {
			await database.db
				.delete(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.organizationId, id.toUUID()));
			await database.db.delete(LedgersTable).where(eq(LedgersTable.organizationId, id.toUUID()));
			await database.db.delete(AssetsTable).where(eq(AssetsTable.organizationId, id.toUUID()));
			await database.db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id.toUUID()));
		}
	}
	await runtime.dispose();
});

describe("Asset persistence", () => {
	it("normalizes, isolates organizations, replaces mutable fields and permits code reuse", async () => {
		const asset = await runtime.runPromise(
			service.createAsset(orgId, {
				code: "usd",
				name: "US Dollar",
				minorUnitExponent: 2,
				description: "Original",
				metadata: { source: "manual" },
			})
		);
		expect(asset.toResponse()).toMatchObject({ code: "USD", minorUnitExponent: 2 });
		expect(asset.id).toBeInstanceOf(TypeID);
		expect(DateTime.isDateTime(asset.created)).toBe(true);
		expect(asset.created.zoneName).toBe("UTC");
		const [stored] = await database.db
			.select()
			.from(AssetsTable)
			.where(eq(AssetsTable.id, encodeUuid(asset.id)));
		expect(asset.toRow()).toEqual(stored);
		expect(asset.metadata).toEqual({ source: "manual" });
		expect(asset.id.toString()).toMatch(/^ast_[0-9a-z]{26}$/);
		const hidden = await runtime.runPromise(Effect.flip(service.getAsset(otherOrgId, asset.id)));
		expect(hidden).toBeInstanceOf(NotFoundError);
		const missingSelector = await runtime.runPromise(
			Effect.flip(service.getAsset(otherOrgId, "USD"))
		);
		expect(missingSelector).toBeInstanceOf(NotFoundError);
		await runtime.runPromise(
			service.createAsset(otherOrgId, { code: "USD", name: "Different Asset", minorUnitExponent: 3 })
		);
		const renamed = await runtime.runPromise(
			service.updateAsset(orgId, asset.id, { code: "usd:old", name: "Renamed" })
		);
		expect(renamed.toResponse()).toMatchObject({
			id: asset.id.toString(),
			code: "USD:OLD",
			minorUnitExponent: 2,
			created: asset.toResponse().created,
		});
		expect(renamed.toResponse().description).toBeUndefined();
		expect(renamed.toResponse().metadata).toBeUndefined();
		const replacement = await runtime.runPromise(
			service.createAsset(orgId, { code: "USD", name: "Replacement", minorUnitExponent: 4 })
		);
		expect(replacement.id.toString()).not.toBe(asset.id.toString());
		expect(
			await runtime.runPromise(
				Effect.forEach([asset.id, "usd"], reference =>
					service.getAsset(orgId, reference).pipe(Effect.map(value => value.toSummary()))
				)
			)
		).toEqual([renamed.toSummary(), replacement.toSummary()]);
		const filtered = await runtime.runPromise(
			service.listAssets(orgId, { offset: 0, limit: 20, code: "usd" })
		);
		expect(filtered.map(value => value.id)).toEqual([replacement.id]);
		const conflict = await runtime.runPromise(
			Effect.flip(service.updateAsset(orgId, asset.id, { code: "usd", name: "Duplicate" }))
		);
		expect(conflict).toBeInstanceOf(ConflictError);
	});

	it.each(["{", "null", "[]", '"text"', '{"count":1}'])(
		"rejects malformed stored metadata %s",
		async metadata => {
			const asset = await runtime.runPromise(
				service.createAsset(orgId, {
					code: `BROKEN:${Buffer.from(metadata).toString("hex")}`,
					name: "Malformed metadata",
					minorUnitExponent: 2,
				})
			);
			await database.db
				.update(AssetsTable)
				.set({ metadata })
				.where(eq(AssetsTable.id, encodeUuid(asset.id)));
			const error = await runtime.runPromise(Effect.flip(service.getAsset(orgId, asset.id)));
			expect(error).toBeInstanceOf(InternalServerError);
			expect(error.message).toBe("Persisted Asset could not be decoded");
		}
	);

	it("enforces uniqueness for concurrent canonical-code creation", async () => {
		const results = await Promise.all(
			["race", "RACE"].map(code =>
				runtime.runPromise(
					Effect.result(service.createAsset(orgId, { code, name: code, minorUnitExponent: 0 }))
				)
			)
		);
		expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
		expect(results.filter(result => result._tag === "Failure")).toHaveLength(1);
	});

	it("restricts deletion of an Asset referenced by an Account", async () => {
		const asset = await runtime.runPromise(
			service.createAsset(orgId, { code: "LOCKED", name: "Referenced", minorUnitExponent: 18 })
		);
		const ledgerId = newLedgerID().toUUID();
		const accountId = newLedgerAccountID().toUUID();
		await database.db
			.insert(LedgersTable)
			.values({ id: ledgerId, organizationId: orgId.toUUID(), name: "Asset reference" });
		await database.db.insert(LedgerAccountsTable).values({
			id: accountId,
			organizationId: orgId.toUUID(),
			ledgerId,
			assetId: encodeUuid(asset.id),
			name: "Referenced",
			normalBalance: "credit",
		});
		expect(
			await runtime.runPromise(Effect.flip(service.deleteAsset(orgId, asset.id)))
		).toBeInstanceOf(ConflictError);
		await database.db.delete(LedgerAccountsTable).where(eq(LedgerAccountsTable.id, accountId));
		await runtime.runPromise(service.deleteAsset(orgId, asset.id));
		expect(await runtime.runPromise(Effect.flip(service.getAsset(orgId, asset.id)))).toBeInstanceOf(
			NotFoundError
		);
	});
});
