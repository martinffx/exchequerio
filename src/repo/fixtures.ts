import {
	LedgerAccountEntity,
	LedgerAccountEntityOpts,
	LedgerEntity,
	LedgerEntityOpts,
} from "@/services"
import { TypeID } from "typeid-js"

function createLedgerEntity(opts: Partial<LedgerEntityOpts> = {}): LedgerEntity {
	return new LedgerEntity({
		id: opts.id ?? new TypeID("lgr"),
		organizationId: opts.organizationId ?? new TypeID("org"),
		name: opts.name ?? "Ledger",
		currency: opts.currency ?? "EUR",
		currencyExponent: opts.currencyExponent ?? 2,
	})
}

function createLedgerAccountEntity(
	opts: Partial<LedgerAccountEntityOpts> = {}
): LedgerAccountEntity {
	return new LedgerAccountEntity({
		id: opts.id ?? new TypeID("lat"),
		ledgerId: opts.ledgerId ?? new TypeID("lgr"),
		name: opts.name ?? "Ledger Account",
		description: opts.description,
		normalBalance: opts.normalBalance ?? "credit",
		balanceAmount: opts.balanceAmount,
		lockVersion: opts.lockVersion ?? 0,
	})
}

export { createLedgerEntity }
