import { eq, sql } from "drizzle-orm";
import { TypeID } from "typeid-js";
import { Effect, Layer, ManagedRuntime, Result } from "effect";
import { Config } from "@/config";
import { type Database, DatabaseTag, type EffectDrizzleDatabase, makeDatabaseLive } from "@/db";
import { AccountNotFound } from "@/domains/ledgers/accounts/AccountErrors";
import { LedgerNotFound } from "@/domains/ledgers/LedgerErrors";
import { LedgerAccountCategoryEntity } from "@/repo/entities/LedgerAccountCategoryEntity";
import {
	CategoryConflict,
	CategoryNotFound,
	CategoryPersistenceDecodingFailure,
	CategoryPersistenceFailure,
	CategoryRepositoryUnavailable,
} from "./LedgerAccountCategoryErrors";
import type {
	LedgerAccountCategoryID,
	LedgerAccountID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import {
	createLedgerAccountEntity,
	createLedgerEntity,
	createOrganizationEntity,
	getRepos,
} from "./fixtures";
import {
	LedgerAccountCategoriesTable,
	LedgerAccountCategoryAccountsTable,
	LedgerAccountCategoryParentsTable,
} from "./schema";
import {
	type LedgerAccountCategoryRepo,
	LedgerAccountCategoryRepoLive,
	LedgerAccountCategoryRepoTag,
	ledgerAccountCategoryRepoLayer,
} from "./LedgerAccountCategoryRepo";

describe("LedgerAccountCategoryRepo", () => {
	const { db, organizationRepo, ledgerRepo, ledgerAccountRepo } = getRepos();
	const runtime: ManagedRuntime.ManagedRuntime<Database | LedgerAccountCategoryRepo, never> =
		ManagedRuntime.make(
			ledgerAccountCategoryRepoLayer.pipe(
				Layer.provideMerge(makeDatabaseLive(new Config().databaseUrl))
			)
		);
	let ledgerAccountCategoryRepo: LedgerAccountCategoryRepo;
	let effectDb: EffectDrizzleDatabase;

	// Test IDs - shared across test suite
	let testOrgId: OrgID;
	let testLedgerId: LedgerID;
	let testCounter = 0;

	beforeAll(async () => {
		ledgerAccountCategoryRepo = await runtime.runPromise(LedgerAccountCategoryRepoTag);
		effectDb = (await runtime.runPromise(DatabaseTag)).effectDb;
		// Create test organization
		testOrgId = new TypeID("org") as OrgID;
		const orgEntity = createOrganizationEntity({
			id: testOrgId,
			name: "Category Test Org",
		});
		await organizationRepo.createOrganization(orgEntity);

		// Create test ledger
		testLedgerId = new TypeID("lgr") as LedgerID;
		const ledgerEntity = createLedgerEntity({
			id: testLedgerId,
			organizationId: testOrgId,
			name: "Category Test Ledger",
		});
		await ledgerRepo.upsertLedger(ledgerEntity);
	});

	afterAll(async () => {
		try {
			await db
				.delete(LedgerAccountCategoriesTable)
				.where(eq(LedgerAccountCategoriesTable.ledgerId, testLedgerId.toUUID()));
			await ledgerRepo.deleteLedger(testOrgId, testLedgerId);
			await organizationRepo.deleteOrganization(testOrgId);
		} finally {
			await runtime.dispose();
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("listLedgerAccountCategories", () => {
		it("maps a native adapter failure into the typed Effect failure channel", async () => {
			const failure = new Error("native adapter failure");
			const repository = new LedgerAccountCategoryRepoLive({
				select: () => ({
					from: () => ({
						where: () => ({
							orderBy: () => ({
								limit: () => ({ offset: () => Effect.fail(failure) }),
							}),
						}),
					}),
				}),
			} as never);

			const result = await Effect.runPromise(
				Effect.result(repository.listLedgerAccountCategories(testOrgId, testLedgerId, 0, 10))
			);

			expect(Result.isFailure(result)).toBe(true);
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(CategoryPersistenceFailure);
				expect(result.failure.cause).toBe(failure);
			}
		});

		it("should return empty array when no categories exist", async () => {
			const categories = await runtime.runPromise(
				ledgerAccountCategoryRepo.listLedgerAccountCategories(testOrgId, testLedgerId, 0, 10)
			);
			expect(categories).toEqual([]);
		});

		it("should list categories with pagination", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: "Assets",
				description: "Asset accounts",
				normalBalance: "debit",
				metadata: { type: "top-level" },
				created: new Date(),
				updated: new Date(),
			});
			await runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity));

			const categories = await runtime.runPromise(
				ledgerAccountCategoryRepo.listLedgerAccountCategories(testOrgId, testLedgerId, 0, 10)
			);
			expect(categories).toHaveLength(1);
			expect(categories[0].name).toBe("Assets");
			expect(categories[0].normalBalance).toBe("debit");

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("orders persisted creation times descending and applies offset and limit", async () => {
			const ids = [
				new TypeID("lac"),
				new TypeID("lac"),
				new TypeID("lac"),
			] as LedgerAccountCategoryID[];
			await db.insert(LedgerAccountCategoriesTable).values(
				ids.map((id, index) => ({
					id: id.toUUID(),
					organizationId: testOrgId.toUUID(),
					ledgerId: testLedgerId.toUUID(),
					name: "Ordered Category",
					normalBalance: "debit" as const,
					created: new Date(["2024-01-03", "2024-01-01", "2024-01-02"][index]),
				}))
			);
			try {
				const categories = await runtime.runPromise(
					ledgerAccountCategoryRepo.listLedgerAccountCategories(testOrgId, testLedgerId, 0, 10)
				);
				expect(categories.map(category => category.id.toString())).toEqual(
					[ids[0], ids[2], ids[1]].map(id => id.toString())
				);
				const page = await runtime.runPromise(
					ledgerAccountCategoryRepo.listLedgerAccountCategories(testOrgId, testLedgerId, 1, 1)
				);
				expect(page.map(category => category.id.toString())).toEqual([ids[2].toString()]);
			} finally {
				for (const id of ids)
					await runtime.runPromise(
						ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, id)
					);
			}
		});
	});

	describe("getLedgerAccountCategory", () => {
		it("should treat malformed stored metadata as absent", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await db.insert(LedgerAccountCategoriesTable).values({
				id: categoryId.toUUID(),
				organizationId: testOrgId.toUUID(),
				ledgerId: testLedgerId.toUUID(),
				name: "Malformed metadata",
				normalBalance: "debit",
				metadata: "{not-json",
			});

			const category = await runtime.runPromise(
				ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);

			expect(category.metadata).toBeUndefined();
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it.each(["created", "updated"] as const)(
			"classifies infinite %s during decoding and deletes without decoding",
			async field => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				await db.insert(LedgerAccountCategoriesTable).values({
					id: categoryId.toUUID(),
					organizationId: testOrgId.toUUID(),
					ledgerId: testLedgerId.toUUID(),
					name: "Infinite timestamp",
					normalBalance: "debit",
					[field]: sql`'infinity'::timestamptz`,
				});
				try {
					const result = await runtime.runPromise(
						Effect.result(
							ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
						)
					);
					expect(Result.isFailure(result)).toBe(true);
					if (Result.isFailure(result)) {
						expect(result.failure).toBeInstanceOf(CategoryPersistenceDecodingFailure);
						expect(result.failure.cause).toBeInstanceOf(Error);
					}
				} finally {
					await runtime.runPromise(
						ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
					);
				}
				expect(
					await db
						.select()
						.from(LedgerAccountCategoriesTable)
						.where(eq(LedgerAccountCategoriesTable.id, categoryId.toUUID()))
				).toEqual([]);
			}
		);

		it("should throw error when category not found", async () => {
			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, testLedgerId, nonExistentId)
				)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);
		});

		it("should return category when found", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: "Liabilities",
				description: "Liability accounts",
				normalBalance: "credit",
				metadata: { code: "2000" },
				created: new Date(),
				updated: new Date(),
			});

			await runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity));

			const category = await runtime.runPromise(
				ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
			expect(category).toBeInstanceOf(LedgerAccountCategoryEntity);
			expect(category.id.toString()).toBe(categoryId.toString());
			expect(category.name).toBe("Liabilities");
			expect(category.description).toBe("Liability accounts");
			expect(category.normalBalance).toBe("credit");
			expect(category.metadata).toEqual({ code: "2000" });

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("should throw error when category belongs to different ledger", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: "Test Category",
				normalBalance: "debit",
				created: new Date(),
				updated: new Date(),
			});
			await runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity));

			// Try to access with different ledger ID
			const differentLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, differentLedgerId, categoryId)
				)
			).rejects.toThrow("Category not found");

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});
	});

	describe("upsertLedgerAccountCategory", () => {
		it("retains encoding failures in the typed Effect channel without executing SQL", async () => {
			const entity = LedgerAccountCategoryEntity.fromRequest(
				{ name: "Encoding", normalBalance: "debit" },
				testOrgId,
				testLedgerId
			);
			const failure = new Error("encoding failed");
			vi.spyOn(entity, "toRecord").mockImplementation(() => {
				throw failure;
			});
			const query = vi.spyOn(effectDb, "insert");
			const program = ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);
			const result = await runtime.runPromise(Effect.result(program));
			expect(Result.isFailure(result)).toBe(true);
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(CategoryPersistenceFailure);
				expect(result.failure.cause).toBe(failure);
			}
			expect(query).not.toHaveBeenCalled();
		});

		describe("create (insert) operations", () => {
			it("should let PostgreSQL set created and the application set updated", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const suppliedTime = new Date("2000-01-01T00:00:00.000Z");
				const applicationTime = new Date("2001-01-01T00:00:00.000Z");
				vi.useFakeTimers({ toFake: ["Date"] });
				vi.setSystemTime(applicationTime);
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					organizationId: testOrgId,
					ledgerId: testLedgerId,
					name: "Timestamp ownership",
					normalBalance: "debit",
					created: suppliedTime,
					updated: suppliedTime,
				});
				const encode = vi.spyOn(entity, "toRecord");
				const query = vi.spyOn(effectDb, "insert");
				const program = ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);
				expect(encode).not.toHaveBeenCalled();
				expect(query).not.toHaveBeenCalled();
				const executionTime = new Date("2002-01-01T00:00:00.000Z");
				vi.setSystemTime(executionTime);
				const created = await runtime.runPromise(program);
				vi.useRealTimers();

				expect(created.created).not.toEqual(suppliedTime);
				expect(created.created).not.toEqual(applicationTime);
				expect(created.updated).toEqual(executionTime);

				await runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);
			});

			it("should create new category with valid data", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					organizationId: testOrgId,
					ledgerId: testLedgerId,
					name: "Revenue",
					description: "Revenue accounts",
					normalBalance: "credit",
					metadata: { type: "income" },
					created: new Date(),
					updated: new Date(),
				});

				const created = await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity)
				);

				expect(created).toBeInstanceOf(LedgerAccountCategoryEntity);
				expect(created.id.toString()).toBe(categoryId.toString());
				expect(created.name).toBe("Revenue");
				expect(created.normalBalance).toBe("credit");
				expect(created.metadata).toEqual({ type: "income" });

				// Cleanup
				await runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);
			});

			it("should throw error when ledger doesn't exist", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const nonExistentLedgerId = new TypeID("lgr") as LedgerID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					organizationId: testOrgId,
					ledgerId: nonExistentLedgerId,
					name: "Test Category",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});

				await expect(
					runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity))
				).rejects.toBeInstanceOf(LedgerNotFound);
				// No cleanup needed - category was never created
			});

			it("should create category with debit normal balance", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					organizationId: testOrgId,
					ledgerId: testLedgerId,
					name: "Expenses",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});

				const created = await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity)
				);
				expect(created.normalBalance).toBe("debit");

				// Cleanup
				await runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);
			});

			it("should create category without description or metadata", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					organizationId: testOrgId,
					ledgerId: testLedgerId,
					name: "Minimal Category",
					normalBalance: "credit",
					created: new Date(),
					updated: new Date(),
				});

				const created = await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity)
				);
				expect(created.description).toBeUndefined();
				expect(created.metadata).toBeUndefined();

				// Cleanup
				await runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);
			});
		});

		describe("update operations", () => {
			it("should preserve created time and apply the last replacement", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const first = await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
						new LedgerAccountCategoryEntity({
							id: categoryId,
							organizationId: testOrgId,
							ledgerId: testLedgerId,
							name: "First writer",
							normalBalance: "debit",
							created: new Date("2000-01-01T00:00:00.000Z"),
							updated: new Date("2000-01-01T00:00:00.000Z"),
						})
					)
				);

				await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
						new LedgerAccountCategoryEntity({ ...first, name: "Second writer" })
					)
				);
				const last = await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
						new LedgerAccountCategoryEntity({ ...first, name: "Last writer" })
					)
				);

				expect(last.name).toBe("Last writer");
				expect(last.created).toEqual(first.created);
				await runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);
			});

			it("should update mutable fields (name, description, metadata)", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					organizationId: testOrgId,
					ledgerId: testLedgerId,
					name: "Original Name",
					description: "Original description",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});
				await runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity));

				const existing = await runtime.runPromise(
					ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);

				const updated = new LedgerAccountCategoryEntity({
					...existing,
					name: "Updated Name",
					description: "Updated description",
					metadata: { updated: "true" },
				});

				const result = await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(updated)
				);

				expect(result.name).toBe("Updated Name");
				expect(result.description).toBe("Updated description");
				expect(result.metadata).toEqual({ updated: "true" });

				// Cleanup
				await runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);
			});

			it("should fail when trying to change ledgerId", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					organizationId: testOrgId,
					ledgerId: testLedgerId,
					name: "Original Name",
					description: "Original description",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});
				await runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity));

				const existing = await runtime.runPromise(
					ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);

				const differentLedgerId = new TypeID("lgr") as LedgerID;
				const updated = new LedgerAccountCategoryEntity({
					...existing,
					ledgerId: differentLedgerId,
				});

				await expect(
					runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(updated))
				).rejects.toThrow();

				// Cleanup
				await runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);
			});
		});

		describe("idempotent create", () => {
			it("should handle create on first call, update on second call", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					organizationId: testOrgId,
					ledgerId: testLedgerId,
					name: "Idempotent Category",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});

				// First create
				const first = await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity)
				);
				expect(first.name).toBe("Idempotent Category");

				// Second call with same ID but different name (update)
				const updated = new LedgerAccountCategoryEntity({
					...first,
					name: "Updated Category",
				});
				const second = await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(updated)
				);
				expect(second.name).toBe("Updated Category");

				// Cleanup
				await runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				);
			});
		});
	});

	describe("deleteLedgerAccountCategory", () => {
		it("should delete category successfully", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: "Category to Delete",
				normalBalance: "debit",
				created: new Date(),
				updated: new Date(),
			});
			await runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity));

			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);

			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				)
			).rejects.toThrow("Category not found");
			// No cleanup needed - resource was deleted
		});

		it("should throw error when category not found", async () => {
			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, nonExistentId)
				)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);
			// No cleanup needed - no resource was created
		});

		it("should throw error when deleting from different ledger", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: "Category to Delete",
				normalBalance: "debit",
				created: new Date(),
				updated: new Date(),
			});
			await runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity));

			const otherLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, otherLedgerId, categoryId)
				)
			).rejects.toThrow("Category not found");

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("should cascade delete category-account links", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: "Category to Delete",
				normalBalance: "debit",
				created: new Date(),
				updated: new Date(),
			});
			await runtime.runPromise(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity));

			// Create an account
			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Delete Cascade Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// Link account to category
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, categoryId, accountId)
			);

			// Delete category (should cascade delete link)
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);

			// Verify category is deleted
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
				)
			).rejects.toThrow("Category not found");

			// Cleanup account
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			// No cleanup needed for category - it was deleted by the test
		});
	});

	describe("linkAccountToCategory", () => {
		it("maps a 23503 Category-read failure instead of translating it to Account not found", async () => {
			const failure = Object.assign(new Error("category read failed"), { code: "23503" });
			const repository = new LedgerAccountCategoryRepoLive({
				select: () => ({
					from: () => ({
						where: () => ({ limit: () => Effect.fail(failure) }),
					}),
				}),
				insert: () => ({
					values: () => ({ onConflictDoNothing: () => Effect.die("insert must not run") }),
				}),
			} as never);

			const result = await Effect.runPromise(
				Effect.result(
					repository.linkAccountToCategory(testOrgId, testLedgerId, new TypeID("lac"), new TypeID("lat"))
				)
			);

			expect(Result.isFailure(result)).toBe(true);
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(CategoryPersistenceFailure);
				expect(result.failure.cause).toBe(failure);
			}
		});

		it("should read the category before linking an account", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Link Test Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			const getCategory = vi.spyOn(ledgerAccountCategoryRepo, "getLedgerAccountCategory");
			const select = vi.spyOn(effectDb, "select");
			const insert = vi.spyOn(effectDb, "insert");
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, categoryId, accountId)
			);

			expect(getCategory).toHaveBeenCalledOnce();
			expect(getCategory).toHaveBeenCalledWith(testOrgId, testLedgerId, categoryId);
			expect(select).toHaveBeenCalledOnce();
			expect(select).toHaveBeenCalledBefore(insert);
			getCategory.mockRestore();

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkAccountFromCategory(
					testOrgId,
					testLedgerId,
					categoryId,
					accountId
				)
			);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("should be idempotent (linking twice should not error)", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Link Test Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// First link
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, categoryId, accountId)
			);

			// Second link should succeed (onConflictDoNothing)
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, categoryId, accountId)
				)
			).resolves.not.toThrow();

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkAccountFromCategory(
					testOrgId,
					testLedgerId,
					categoryId,
					accountId
				)
			);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("should throw error when category doesn't exist", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Link Test Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			const nonExistentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkAccountToCategory(
						testOrgId,
						testLedgerId,
						nonExistentCategoryId,
						accountId
					)
				)
			).rejects.toThrow(`Category not found: ${nonExistentCategoryId.toString()}`);

			// Cleanup
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("should report the category first when both category and account are missing", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const accountId = new TypeID("lat") as LedgerAccountID;
			const getAccount = vi.spyOn(ledgerAccountRepo, "getLedgerAccount");
			const insert = vi.spyOn(db, "insert");

			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, categoryId, accountId)
				)
			).rejects.toThrow(`Category not found: ${categoryId.toString()}`);

			expect(getAccount).not.toHaveBeenCalled();
			expect(insert).not.toHaveBeenCalled();
		});

		it("should throw error when account doesn't exist", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Link Test Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			const nonExistentAccountId = new TypeID("lat") as LedgerAccountID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkAccountToCategory(
						testOrgId,
						testLedgerId,
						categoryId,
						nonExistentAccountId
					)
				)
			).rejects.toBeInstanceOf(AccountNotFound);

			// Cleanup
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("should throw error when category belongs to different ledger", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Link Test Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			const otherLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkAccountToCategory(
						testOrgId,
						otherLedgerId,
						categoryId,
						accountId
					)
				)
			).rejects.toThrow("Category not found");

			// Cleanup
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});
	});

	describe("unlinkAccountFromCategory", () => {
		it("should read only the category before unlinking an account", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Unlink Test Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Unlink Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// Link them
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, categoryId, accountId)
			);

			const getCategory = vi.spyOn(ledgerAccountCategoryRepo, "getLedgerAccountCategory");
			const deleteRows = vi.spyOn(effectDb, "delete");
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkAccountFromCategory(
					testOrgId,
					testLedgerId,
					categoryId,
					accountId
				)
			);
			expect(getCategory).toHaveBeenCalledOnce();
			expect(getCategory).toHaveBeenCalledWith(testOrgId, testLedgerId, categoryId);
			expect(getCategory).toHaveBeenCalledBefore(deleteRows);
			getCategory.mockRestore();

			// Try to unlink again - should fail
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.unlinkAccountFromCategory(
						testOrgId,
						testLedgerId,
						categoryId,
						accountId
					)
				)
			).rejects.toThrow(
				`Account ${accountId.toString()} not linked to category ${categoryId.toString()}`
			);

			// Cleanup
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("should throw error when link doesn't exist", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Unlink Test Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Unlink Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// Link them
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, categoryId, accountId)
			);

			const unlinkedAccountId = new TypeID("lat") as LedgerAccountID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.unlinkAccountFromCategory(
						testOrgId,
						testLedgerId,
						categoryId,
						unlinkedAccountId
					)
				)
			).rejects.toThrow(
				`Account ${unlinkedAccountId.toString()} not linked to category ${categoryId.toString()}`
			);

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkAccountFromCategory(
					testOrgId,
					testLedgerId,
					categoryId,
					accountId
				)
			);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("should throw error when category doesn't exist", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Unlink Test Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Unlink Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// Link them
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, categoryId, accountId)
			);

			const nonExistentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.unlinkAccountFromCategory(
						testOrgId,
						testLedgerId,
						nonExistentCategoryId,
						accountId
					)
				)
			).rejects.toThrow(`Category not found: ${nonExistentCategoryId.toString()}`);

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkAccountFromCategory(
					testOrgId,
					testLedgerId,
					categoryId,
					accountId
				)
			);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});
	});

	describe("linkCategoryToParent", () => {
		it("should read the child then parent before linking categories", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const getCategory = vi.spyOn(ledgerAccountCategoryRepo, "getLedgerAccountCategory");
			const insert = vi.spyOn(effectDb, "insert");
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkCategoryToParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);

			expect(getCategory.mock.calls).toEqual([
				[testOrgId, testLedgerId, childCategoryId],
				[testOrgId, testLedgerId, parentCategoryId],
			]);
			expect(getCategory.mock.invocationCallOrder[1]).toBeLessThan(insert.mock.invocationCallOrder[0]);
			getCategory.mockRestore();

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});

		it("should be idempotent (linking twice should not error)", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			// First link
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkCategoryToParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);

			// Second link should succeed (onConflictDoNothing)
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkCategoryToParent(
						testOrgId,
						testLedgerId,
						childCategoryId,
						parentCategoryId
					)
				)
			).resolves.not.toThrow();

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});

		it("should allow multiple parents (many-to-many)", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			// Create second parent
			const parent2Id = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parent2Id,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: "Second Parent Category",
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			// Link to first parent
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkCategoryToParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);

			// Link to second parent - should succeed
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkCategoryToParent(
						testOrgId,
						testLedgerId,
						childCategoryId,
						parent2Id
					)
				)
			).resolves.not.toThrow();

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parent2Id
				)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parent2Id)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});

		it("should prevent self-referential parent link", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const insert = vi.spyOn(db, "insert");
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkCategoryToParent(
						testOrgId,
						testLedgerId,
						childCategoryId,
						childCategoryId
					)
				)
			).rejects.toThrow("Category cannot be its own parent");
			expect(insert).not.toHaveBeenCalled();

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});

		it("should report not found before self-link conflict for a missing category", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const insert = vi.spyOn(db, "insert");

			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkCategoryToParent(testOrgId, testLedgerId, categoryId, categoryId)
				)
			).rejects.toThrow(`Category not found: ${categoryId.toString()}`);

			expect(insert).not.toHaveBeenCalled();
		});

		it("should throw error when child category doesn't exist", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkCategoryToParent(
						testOrgId,
						testLedgerId,
						nonExistentId,
						parentCategoryId
					)
				)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});

		it("should report the child first when both child and parent are missing", async () => {
			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const insert = vi.spyOn(db, "insert");

			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkCategoryToParent(
						testOrgId,
						testLedgerId,
						childCategoryId,
						parentCategoryId
					)
				)
			).rejects.toThrow(`Category not found: ${childCategoryId.toString()}`);

			expect(insert).not.toHaveBeenCalled();
		});

		it("should throw error when parent category doesn't exist", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkCategoryToParent(
						testOrgId,
						testLedgerId,
						childCategoryId,
						nonExistentId
					)
				)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});

		it("should throw error when categories belong to different ledgers", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			// Create another ledger
			const otherLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkCategoryToParent(
						testOrgId,
						otherLedgerId,
						childCategoryId,
						parentCategoryId
					)
				)
			).rejects.toThrow("Category not found");

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});
	});

	describe("unlinkCategoryFromParent", () => {
		it("should read only the child before unlinking categories", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			// Link them
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkCategoryToParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);

			const getCategory = vi.spyOn(ledgerAccountCategoryRepo, "getLedgerAccountCategory");
			const deleteRows = vi.spyOn(effectDb, "delete");
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);
			expect(getCategory).toHaveBeenCalledOnce();
			expect(getCategory).toHaveBeenCalledWith(testOrgId, testLedgerId, childCategoryId);
			expect(getCategory).toHaveBeenCalledBefore(deleteRows);
			getCategory.mockRestore();

			// Try to unlink again - should fail
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.unlinkCategoryFromParent(
						testOrgId,
						testLedgerId,
						childCategoryId,
						parentCategoryId
					)
				)
			).rejects.toThrow(
				`Category ${childCategoryId.toString()} not linked to parent ${parentCategoryId.toString()}`
			);

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});

		it("should throw error when link doesn't exist", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			// Link them
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkCategoryToParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);

			const unlinkedParentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.unlinkCategoryFromParent(
						testOrgId,
						testLedgerId,
						childCategoryId,
						unlinkedParentId
					)
				)
			).rejects.toThrow(
				`Category ${childCategoryId.toString()} not linked to parent ${unlinkedParentId.toString()}`
			);

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});

		it("should throw error when child category doesn't exist", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: parentCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Parent Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: childCategoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: `Child Category ${testCounter}`,
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			// Link them
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkCategoryToParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);

			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.unlinkCategoryFromParent(
						testOrgId,
						testLedgerId,
						nonExistentId,
						parentCategoryId
					)
				)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);

			// Cleanup
			await runtime.runPromise(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testOrgId,
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childCategoryId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentCategoryId)
			);
		});
	});

	describe("ledger isolation", () => {
		let ledger1Id: LedgerID;
		let ledger2Id: LedgerID;
		let category1Id: LedgerAccountCategoryID;
		let category2Id: LedgerAccountCategoryID;

		beforeAll(async () => {
			// Create two ledgers in the same organization
			ledger1Id = new TypeID("lgr") as LedgerID;
			ledger2Id = new TypeID("lgr") as LedgerID;

			await ledgerRepo.upsertLedger(
				createLedgerEntity({
					id: ledger1Id,
					organizationId: testOrgId,
					name: "Ledger 1",
				})
			);
			await ledgerRepo.upsertLedger(
				createLedgerEntity({
					id: ledger2Id,
					organizationId: testOrgId,
					name: "Ledger 2",
				})
			);

			// Create categories in each ledger
			category1Id = new TypeID("lac") as LedgerAccountCategoryID;
			category2Id = new TypeID("lac") as LedgerAccountCategoryID;

			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: category1Id,
						organizationId: testOrgId,
						ledgerId: ledger1Id,
						name: "Category 1",
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: category2Id,
						organizationId: testOrgId,
						ledgerId: ledger2Id,
						name: "Category 2",
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);
		});

		afterAll(async () => {
			// Clean up
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, ledger1Id, category1Id)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, ledger2Id, category2Id)
			);
			await ledgerRepo.deleteLedger(testOrgId, ledger1Id);
			await ledgerRepo.deleteLedger(testOrgId, ledger2Id);
		});

		it("should not allow ledger1 to access ledger2's categories", async () => {
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, ledger1Id, category2Id)
				)
			).rejects.toThrow("Category not found");
		});

		it("should not allow ledger2 to access ledger1's categories", async () => {
			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.getLedgerAccountCategory(testOrgId, ledger2Id, category1Id)
				)
			).rejects.toThrow("Category not found");
		});

		it("should list only own ledger's categories", async () => {
			const ledger1Categories = await runtime.runPromise(
				ledgerAccountCategoryRepo.listLedgerAccountCategories(testOrgId, ledger1Id, 0, 10)
			);
			expect(ledger1Categories).toHaveLength(1);
			expect(ledger1Categories[0].id.toString()).toBe(category1Id.toString());

			const ledger2Categories = await runtime.runPromise(
				ledgerAccountCategoryRepo.listLedgerAccountCategories(testOrgId, ledger2Id, 0, 10)
			);
			expect(ledger2Categories).toHaveLength(1);
			expect(ledger2Categories[0].id.toString()).toBe(category2Id.toString());
		});
	});

	describe("Organization ownership and typed failures", () => {
		it.each([
			["upsert", "23503", "ledger_account_categories_organization_ledger_fk", LedgerNotFound],
			["account", "23503", "ledger_account_category_accounts_account_ownership_fk", AccountNotFound],
			["account", "23503", "ledger_account_category_accounts_category_ownership_fk", CategoryNotFound],
			["parent", "23503", "ledger_account_category_parents_child_ownership_fk", CategoryNotFound],
			["parent", "23503", "ledger_account_category_parents_parent_ownership_fk", CategoryNotFound],
			["parent", "23514", "check_no_self_reference", CategoryConflict],
		] as const)("retains SQL cause for %s %s %s", async (operation, code, constraint, ErrorType) => {
			const cause = Object.assign(new Error("constraint failure"), { code, constraint });
			const entity = LedgerAccountCategoryEntity.fromRequest(
				{ name: "Mapped failure", normalBalance: "debit" },
				testOrgId,
				testLedgerId
			);
			const repository = new LedgerAccountCategoryRepoLive({
				insert: () => ({
					values: () => ({
						onConflictDoUpdate: () => ({ returning: () => Effect.fail(cause) }),
						onConflictDoNothing: () => Effect.fail(cause),
					}),
				}),
			} as never);
			vi.spyOn(repository, "getLedgerAccountCategory").mockReturnValue(Effect.succeed(entity));
			const program =
				operation === "upsert"
					? repository.upsertLedgerAccountCategory(entity)
					: operation === "account"
						? repository.linkAccountToCategory(
								testOrgId,
								testLedgerId,
								entity.id,
								new TypeID("lat") as LedgerAccountID
							)
						: repository.linkCategoryToParent(
								testOrgId,
								testLedgerId,
								entity.id,
								new TypeID("lac") as LedgerAccountCategoryID
							);
			const result = await Effect.runPromise(Effect.result(program));
			expect(Result.isFailure(result)).toBe(true);
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(ErrorType);
				expect(result.failure.cause).toBe(cause);
			}
		});

		it("makes every read, delete, and relationship operation invisible cross-Organization", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const accountId = new TypeID("lat") as LedgerAccountID;
			const foreignOrganizationId = new TypeID("org") as OrgID;
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: "Tenant scoped",
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			expect(
				await runtime.runPromise(
					ledgerAccountCategoryRepo.listLedgerAccountCategories(
						foreignOrganizationId,
						testLedgerId,
						0,
						20
					)
				)
			).toEqual([]);
			const operations = [
				() =>
					runtime.runPromise(
						ledgerAccountCategoryRepo.getLedgerAccountCategory(
							foreignOrganizationId,
							testLedgerId,
							categoryId
						)
					),
				() =>
					runtime.runPromise(
						ledgerAccountCategoryRepo.deleteLedgerAccountCategory(
							foreignOrganizationId,
							testLedgerId,
							categoryId
						)
					),
				() =>
					runtime.runPromise(
						ledgerAccountCategoryRepo.linkAccountToCategory(
							foreignOrganizationId,
							testLedgerId,
							categoryId,
							accountId
						)
					),
				() =>
					runtime.runPromise(
						ledgerAccountCategoryRepo.unlinkAccountFromCategory(
							foreignOrganizationId,
							testLedgerId,
							categoryId,
							accountId
						)
					),
				() =>
					runtime.runPromise(
						ledgerAccountCategoryRepo.linkCategoryToParent(
							foreignOrganizationId,
							testLedgerId,
							categoryId,
							categoryId
						)
					),
				() =>
					runtime.runPromise(
						ledgerAccountCategoryRepo.unlinkCategoryFromParent(
							foreignOrganizationId,
							testLedgerId,
							categoryId,
							categoryId
						)
					),
			];
			for (const operation of operations) {
				await expect(operation()).rejects.toBeInstanceOf(CategoryNotFound);
			}
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
		});

		it("writes Organization and Ledger ownership to both junction tables", async () => {
			const childId = new TypeID("lac") as LedgerAccountCategoryID;
			const parentId = new TypeID("lac") as LedgerAccountCategoryID;
			const accountId = new TypeID("lat") as LedgerAccountID;
			for (const id of [childId, parentId]) {
				await runtime.runPromise(
					ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
						new LedgerAccountCategoryEntity({
							id,
							organizationId: testOrgId,
							ledgerId: testLedgerId,
							name: `Ownership ${id.toString()}`,
							normalBalance: "debit",
							created: new Date(),
							updated: new Date(),
						})
					)
				);
			}
			await ledgerAccountRepo.upsertLedgerAccount(
				createLedgerAccountEntity({
					id: accountId,
					organizationId: testOrgId,
					ledgerId: testLedgerId,
				})
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, childId, accountId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.linkCategoryToParent(testOrgId, testLedgerId, childId, parentId)
			);

			const [accountLink] = await db
				.select()
				.from(LedgerAccountCategoryAccountsTable)
				.where(eq(LedgerAccountCategoryAccountsTable.categoryId, childId.toUUID()));
			const [parentLink] = await db
				.select()
				.from(LedgerAccountCategoryParentsTable)
				.where(eq(LedgerAccountCategoryParentsTable.categoryId, childId.toUUID()));
			expect(accountLink).toMatchObject({
				organizationId: testOrgId.toUUID(),
				ledgerId: testLedgerId.toUUID(),
			});
			expect(parentLink).toMatchObject({
				organizationId: testOrgId.toUUID(),
				ledgerId: testLedgerId.toUUID(),
			});

			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, childId)
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, parentId)
			);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
		});

		it("rejects an existing Account from a different Ledger", async () => {
			const otherLedgerId = new TypeID("lgr") as LedgerID;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const accountId = new TypeID("lat") as LedgerAccountID;
			await ledgerRepo.upsertLedger(
				createLedgerEntity({ id: otherLedgerId, organizationId: testOrgId, name: "Other" })
			);
			await ledgerAccountRepo.upsertLedgerAccount(
				createLedgerAccountEntity({
					id: accountId,
					organizationId: testOrgId,
					ledgerId: otherLedgerId,
				})
			);
			await runtime.runPromise(
				ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
					new LedgerAccountCategoryEntity({
						id: categoryId,
						organizationId: testOrgId,
						ledgerId: testLedgerId,
						name: "Owned Category",
						normalBalance: "debit",
						created: new Date(),
						updated: new Date(),
					})
				)
			);

			await expect(
				runtime.runPromise(
					ledgerAccountCategoryRepo.linkAccountToCategory(testOrgId, testLedgerId, categoryId, accountId)
				)
			).rejects.toBeInstanceOf(AccountNotFound);

			await runtime.runPromise(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testOrgId, testLedgerId, categoryId)
			);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, otherLedgerId, accountId);
			await ledgerRepo.deleteLedger(testOrgId, otherLedgerId);
		});

		it.each([
			[Object.assign(new Error("offline"), { code: "08006" }), CategoryRepositoryUnavailable],
			[new Error("unexpected database failure"), CategoryPersistenceFailure],
		])("maps persistence failures through the Category contract %#", async (failure, ErrorType) => {
			const repository = new LedgerAccountCategoryRepoLive({
				select: () => ({
					from: () => ({
						where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => Effect.fail(failure) }) }) }),
					}),
				}),
			} as never);
			const result = await Effect.runPromise(
				Effect.result(repository.listLedgerAccountCategories(testOrgId, testLedgerId, 0, 20))
			);
			expect(Result.isFailure(result)).toBe(true);
			if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ErrorType);
		});
	});
});
