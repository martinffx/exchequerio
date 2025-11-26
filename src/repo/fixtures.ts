import { TypeID } from "typeid-js"
import { LedgerAccountEntity, LedgerEntity } from "@/services/entities"
import type { LedgerAccountEntityOpts } from "@/services/entities/LedgerAccountEntity"
import type { LedgerEntityOpts } from "@/services/entities/LedgerEntity"

function createLedgerEntity(options: Partial<LedgerEntityOpts> = {}): LedgerEntity {
	const now = new Date()
	return new LedgerEntity({
		id: options.id ?? new TypeID("lgr"),
		organizationId: options.organizationId ?? new TypeID("org"),
		name: options.name ?? "Ledger",
		description: options.description,
		currency: options.currency ?? "EUR",
		currencyExponent: options.currencyExponent ?? 2,
		metadata: options.metadata,
		created: options.created ?? now,
		updated: options.updated ?? now,
	})
}

function _createLedgerAccountEntity(
	options: Partial<LedgerAccountEntityOpts> = {}
): LedgerAccountEntity {
	const now = new Date()
	return new LedgerAccountEntity({
		id: options.id ?? new TypeID("lat"),
		ledgerId: options.ledgerId ?? new TypeID("lgr"),
		name: options.name ?? "Ledger Account",
		description: options.description,
		normalBalance: options.normalBalance ?? "credit",
		balanceAmount: options.balanceAmount ?? "0",
		lockVersion: options.lockVersion ?? 0,
		metadata: options.metadata,
		created: options.created ?? now,
		updated: options.updated ?? now,
	})
}

export { createLedgerEntity }
