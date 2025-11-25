import { LedgerAccountEntity, LedgerEntity } from "@/services/entities"
import type { LedgerAccountEntityOpts } from "@/services/entities/LedgerAccountEntity"
import type { LedgerEntityOpts } from "@/services/entities/LedgerEntity"
import { TypeID } from "typeid-js"

function createLedgerEntity(opts: Partial<LedgerEntityOpts> = {}): LedgerEntity {
	const now = new Date()
	return new LedgerEntity({
		id: opts.id ?? new TypeID("lgr"),
		organizationId: opts.organizationId ?? new TypeID("org"),
		name: opts.name ?? "Ledger",
		description: opts.description,
		currency: opts.currency ?? "EUR",
		currencyExponent: opts.currencyExponent ?? 2,
		metadata: opts.metadata,
		created: opts.created ?? now,
		updated: opts.updated ?? now,
	})
}

function createLedgerAccountEntity(
	opts: Partial<LedgerAccountEntityOpts> = {}
): LedgerAccountEntity {
	const now = new Date()
	return new LedgerAccountEntity({
		id: opts.id ?? new TypeID("lat"),
		ledgerId: opts.ledgerId ?? new TypeID("lgr"),
		name: opts.name ?? "Ledger Account",
		description: opts.description,
		normalBalance: opts.normalBalance ?? "credit",
		balanceAmount: opts.balanceAmount ?? "0",
		lockVersion: opts.lockVersion ?? 0,
		metadata: opts.metadata,
		created: opts.created ?? now,
		updated: opts.updated ?? now,
	})
}

export { createLedgerEntity }
