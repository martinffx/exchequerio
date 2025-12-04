import type { FastifyPluginAsync } from "fastify";

// TODO: This is an incomplete feature - service methods don't exist yet
// These routes need:
// - ledgerTransactionService.listLedgerTransactionEntries()
// - ledgerTransactionService.getLedgerTransactionEntry()
// - ledgerTransactionService.updateLedgerTransactionEntry()

const LedgerTransactionEntriesRoutes: FastifyPluginAsync = async _server => {
	// Routes commented out until service methods are implemented
};

export { LedgerTransactionEntriesRoutes };
