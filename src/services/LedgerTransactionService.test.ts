import { describe, it } from "vitest";

// TODO: Rewrite these tests to use proper LedgerTransactionRequest schema
// The schema requires full entry objects with id, currency, currencyExponent, status, etc.
// which makes unit testing at the service layer complex.
// These tests should either:
// 1. Be moved to integration tests where we can use real fixtures
// 2. Use a builder pattern to create valid request objects
// 3. Focus on testing the actual service methods that exist (createTransaction, postTransaction, etc.)

describe.skip("LedgerTransactionService", () => {
	it("TODO: Implement proper service layer tests", () => {
		// Service methods to test:
		// - createTransaction(orgId, ledgerId, request)
		// - postTransaction(orgId, ledgerId, transactionId)
		// - deleteTransaction(orgId, ledgerId, transactionId)
		// - listTransactions(orgId, ledgerId, offset, limit)
		// - getLedgerTransaction(orgId, ledgerId, transactionId)
	});
});
