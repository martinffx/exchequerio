import { type Static, Type } from "@sinclair/typebox";

const Metadata = Type.Mapped(Type.KeyOf(Type.String()), () => Type.String(), {
	description:
		"Additional data represented as key-value pairs. Both the key and value must be strings.",
});

const NormalBalance = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);

const SettlementStatus = Type.Union([
	Type.Literal("drafting"),
	Type.Literal("processing"),
	Type.Literal("pending"),
	Type.Literal("posted"),
	Type.Literal("archiving"),
	Type.Literal("archived"),
]);

const LedgerAccountSettlementTransactionId = Type.String({
	description: "Transaction created by the Ledger Account Settlement.",
	pattern: "^ltr_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});

const LedgerAccountSettlementId = Type.String({
	description: "Unique identifier for the ledger account settlement.",
	pattern: "^las_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});

const LedgerAccountSettlementIdParams = Type.Object({
	settlementId: LedgerAccountSettlementId,
});

const LedgerAccountSettlementResponse = Type.Object(
	{
		id: LedgerAccountSettlementId,
		transactionId: LedgerAccountSettlementTransactionId,
		description: Type.Optional(
			Type.String({ description: "An optional free-form description for internal use." })
		),
		status: SettlementStatus,
		normalBalance: NormalBalance,
		settledAccountId: Type.String({
			description:
				"The Ledger Account that we will query the Entries against, and its balance is reduced as a result. The settled ledger account and the contra ledger account must belong to the same ledger.",
		}),
		contraAccountId: Type.String({
			description:
				"The Ledger Account that sends to or receives funds from the settled ledger account. The settled ledger account and the contra ledger account must belong to the same ledger.",
		}),
		amount: Type.Number({ description: "The amount of the settlement." }),
		currency: Type.String({ description: "The currency of the ledger account settlement." }),
		externalReference: Type.Optional(
			Type.String({ description: "External reference for reconciliation with external systems." })
		),
		metadata: Type.Optional(Metadata),
		created: Type.String({
			description: "Timestamp of when the ledger account category was created.",
		}),
		updated: Type.String({
			description: "Timestamp of when the ledger account category was last updated.",
		}),
	},
	{
		$id: "LedgerAccountSettlementResponse",
		description:
			"A ledger account settlement is an object that creates a ledger transaction to safely offset the posted balance of a ledger account. ",
	}
);

const LedgerAccountSettlementRequest = Type.Object(
	{
		transactionId: LedgerAccountSettlementTransactionId,
		description: Type.Optional(
			Type.String({ description: "An optional free-form description for internal use." })
		),
		status: SettlementStatus,
		settledAccountId: Type.String({
			description:
				"The Ledger Account that we will query the Entries against, and its balance is reduced as a result. The settled ledger account and the contra ledger account must belong to the same ledger.",
		}),
		contraAccountId: Type.String({
			description:
				"The Ledger Account that sends to or receives funds from the settled ledger account. The settled ledger account and the contra ledger account must belong to the same ledger.",
		}),
		effectiveAtUpperBound: Type.Optional(
			Type.String({
				description:
					"Upper bound for auto-gathering entries by effective date. When status is pending/posted, entries with effective_at <= this bound will be automatically gathered. Optional - defaults to current time if not specified.",
			})
		),
		externalReference: Type.Optional(
			Type.String({ description: "External reference for reconciliation with external systems." })
		),
		metadata: Type.Optional(Metadata),
	},
	{ $id: "LedgerAccountSettlementRequest" }
);

const LedgerAccountSettlementEntriesRequest = Type.Object({
	entries: Type.Array(Type.String({ description: "The ID of the Ledger Transaction Entry." })),
});

type LedgerAccountSettlementId = Static<typeof LedgerAccountSettlementId>;
type LedgerAccountSettlementRequest = Static<typeof LedgerAccountSettlementRequest>;
type LedgerAccountSettlementResponse = Static<typeof LedgerAccountSettlementResponse>;
type LedgerAccountSettlementEntriesRequest = Static<typeof LedgerAccountSettlementEntriesRequest>;
type NormalBalance = Static<typeof NormalBalance>;
type SettlementStatus = Static<typeof SettlementStatus>;

export {
	LedgerAccountSettlementEntriesRequest,
	LedgerAccountSettlementId,
	LedgerAccountSettlementIdParams,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	NormalBalance,
	SettlementStatus,
};
