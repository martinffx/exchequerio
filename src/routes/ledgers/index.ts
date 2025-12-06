import type { FastifyPluginAsync } from "fastify";
import { LedgerAccountBalanceMonitorRoutes } from "./LedgerAccountBalanceMonitorRoutes";
import { LedgerAccountCategoryRoutes } from "./LedgerAccountCategoryRoutes";
import { LedgerAccountRoutes } from "./LedgerAccountRoutes";
import { LedgerAccountSettlementRoutes } from "./LedgerAccountSettlementRoutes";
import { LedgerAccountStatementRoutes } from "./LedgerAccountStatementRoutes";
import { LedgerRoutes } from "./LedgerRoutes";
import { LedgerTransactionRoutes } from "./LedgerTransactionRoutes";

const LedgerRouterPlugin: FastifyPluginAsync = async server => {
	await server.register(LedgerAccountCategoryRoutes, {
		prefix: "/:ledgerId/accounts/categories",
	});
	await server.register(LedgerAccountSettlementRoutes, {
		prefix: "/:ledgerId/settlements",
	});
	await server.register(LedgerAccountStatementRoutes, {
		prefix: "/:ledgerId/accounts/:accountId/statements",
	});
	await server.register(LedgerAccountBalanceMonitorRoutes, {
		prefix: "/:ledgerId/accounts/:accountId/balance-monitors",
	});
	await server.register(LedgerAccountRoutes, { prefix: "/:ledgerId/accounts" });
	await server.register(LedgerTransactionRoutes, {
		prefix: "/:ledgerId/transactions",
	});
	await server.register(LedgerRoutes);
};

export { LedgerRouterPlugin };
