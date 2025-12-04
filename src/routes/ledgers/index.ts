import type { FastifyPluginAsync } from "fastify";
import { LedgerAccountBalanceMonitorRoutes } from "./LedgerAccountBalanceMonitorRoutes";
import { LedgerAccountCategoryRoutes } from "./LedgerAccountCategoryRoutes";
import { LedgerAccountRoutes } from "./LedgerAccountRoutes";
import { LedgerAccountSettlementRoutes } from "./LedgerAccountSettlementRoutes";
import { LedgerAccountStatementRoutes } from "./LedgerAccountStatementRoutes";
import { LedgerRoutes } from "./LedgerRoutes";
import { LedgerTransactionEntriesRoutes } from "./LedgerTransactionEntriesRoutes";
import { LedgerTransactionRoutes } from "./LedgerTransactionRoutes";

const LedgerRouterPlugin: FastifyPluginAsync = async server => {
	await server.register(LedgerRoutes);
	await server.register(LedgerTransactionRoutes, {
		prefix: "/:ledgerId/transactions",
	});
	await server.register(LedgerTransactionEntriesRoutes, {
		prefix: "/transactions/entries",
	});
	await server.register(LedgerAccountRoutes, { prefix: "/:ledgerId/accounts" });
	await server.register(LedgerAccountCategoryRoutes, {
		prefix: "/accounts/categories",
	});
	await server.register(LedgerAccountSettlementRoutes, {
		prefix: "/accounts/settlements",
	});
	await server.register(LedgerAccountStatementRoutes, {
		prefix: "/accounts/statements",
	});
	await server.register(LedgerAccountBalanceMonitorRoutes, {
		prefix: "/accounts/balance-monitors",
	});
};

export { LedgerRouterPlugin };
