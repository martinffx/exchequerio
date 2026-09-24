import { CloneType, type Static, Type } from "@sinclair/typebox";
import type { FastifyRequest } from "fastify";
import { AssetSummarySchema } from "@/lib/AssetSchema";
import { AccountBalanceResponse } from "../AccountSchema";
import { MetadataSchema } from "@/lib/schema";
import type { PaginationQuery } from "@/lib/schema";
import { LedgerIdSchema } from "@/domains/ledgers/LedgerSchema";
import {
	AccountIdSchema,
	NormalBalanceSchema as NormalBalance,
} from "@/domains/ledgers/accounts/AccountSchema";

const LedgerId = CloneType(LedgerIdSchema, { description: "The ledger's ID" });
const LedgerIdParameters = Type.Object({ ledgerId: LedgerId });
type LedgerIdParameters = Static<typeof LedgerIdParameters>;
const LedgerAccountId = CloneType(AccountIdSchema, { description: "The ledger account's ID" });

const LedgerAccountCategoryId = Type.String({
	description: "Unique identifier for the ledger account category.",
	pattern: "^lac_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
type LedgerAccountCategoryId = Static<typeof LedgerAccountCategoryId>;
const LedgerAccountCategoryIdParameters = Type.Object({
	categoryId: LedgerAccountCategoryId,
});
type LedgerAccountCategoryIdParameters = Static<typeof LedgerAccountCategoryIdParameters>;

const LinkAccountToCategoryParameters = Type.Object({
	categoryId: LedgerAccountCategoryId,
	accountId: LedgerAccountId,
});
type LinkAccountToCategoryParameters = Static<typeof LinkAccountToCategoryParameters>;

const LinkCategoryToCategoryParameters = Type.Object({
	categoryId: LedgerAccountCategoryId,
	parentCategoryId: LedgerAccountCategoryId,
});
type LinkCategoryToCategoryParameters = Static<typeof LinkCategoryToCategoryParameters>;

const LedgerAccountCategoryResponse = Type.Object(
	{
		id: LedgerAccountCategoryId,
		ledgerId: LedgerId,
		name: Type.String({
			description: "The name of the ledger account category.",
		}),
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		normalBalance: NormalBalance,
		metadata: Type.Optional(MetadataSchema),
		created: Type.String({
			description: "Timestamp of when the ledger account category was created.",
		}),
		updated: Type.String({
			description: "Timestamp of when the ledger account category was last updated.",
		}),
	},
	{
		$id: "LedgerAccountCategoryResponse",
		description:
			"A ledger account category is a grouping of Ledger Accounts. Current balances are available from the Category balances endpoint. Ledger Account Categories can also contain other categories, which enables the creation of nested hierarchies.",
	}
);
type LedgerAccountCategoryResponse = Static<typeof LedgerAccountCategoryResponse>;
const LedgerAccountCategoryBalancesResponse = Type.Object(
	{
		categoryId: LedgerAccountCategoryId,
		normalBalance: NormalBalance,
		assets: Type.Array(
			Type.Object({
				...AssetSummarySchema.properties,
				balances: Type.Array(AccountBalanceResponse),
			})
		),
	},
	{ $id: "LedgerAccountCategoryBalancesResponse" }
);
type LedgerAccountCategoryBalancesResponse = Static<typeof LedgerAccountCategoryBalancesResponse>;

const LedgerAccountCategoryRequest = Type.Object(
	{
		name: Type.String({
			description: "The name of the ledger account category.",
		}),
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		normalBalance: NormalBalance,
		metadata: Type.Optional(MetadataSchema),
	},
	{
		$id: "LedgerAccountCategoryRequest",
	}
);
type LedgerAccountCategoryRequest = Static<typeof LedgerAccountCategoryRequest>;

type ListLedgerAccountCategoriesRequest = FastifyRequest<{
	Params: LedgerIdParameters;
	Querystring: PaginationQuery;
}>;
type GetLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LedgerAccountCategoryIdParameters;
}>;
type CreateLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters;
	Body: LedgerAccountCategoryRequest;
}>;
type UpdateLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LedgerAccountCategoryIdParameters;
	Body: LedgerAccountCategoryRequest;
}>;
type DeleteLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LedgerAccountCategoryIdParameters;
}>;
type LinkLedgerAccountToCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LinkAccountToCategoryParameters;
}>;
type UnlinkLedgerAccountToCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LinkAccountToCategoryParameters;
}>;
type LinkLedgerAccountCategoryToCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LinkCategoryToCategoryParameters;
}>;
type UnlinkLedgerAccountCategoryToCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LinkCategoryToCategoryParameters;
}>;

export {
	LedgerAccountCategoryBalancesResponse,
	LedgerIdParameters,
	LinkAccountToCategoryParameters as LinkAccountToCategoryParams,
	LinkCategoryToCategoryParameters as LinkCategoryToCategoryParams,
	LedgerAccountCategoryIdParameters as LedgerAccountCategoryIdParams,
	LedgerAccountCategoryResponse,
	LedgerAccountCategoryRequest,
	type ListLedgerAccountCategoriesRequest,
	type GetLedgerAccountCategoryRequest,
	type CreateLedgerAccountCategoryRequest,
	type UpdateLedgerAccountCategoryRequest,
	type DeleteLedgerAccountCategoryRequest,
	type LinkLedgerAccountToCategoryRequest,
	type UnlinkLedgerAccountToCategoryRequest,
	type LinkLedgerAccountCategoryToCategoryRequest,
	type UnlinkLedgerAccountCategoryToCategoryRequest,
	type LedgerAccountCategoryId,
};
