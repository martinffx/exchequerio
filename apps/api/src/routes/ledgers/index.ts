import type { FastifyPluginAsync } from "fastify";
import { LedgerRoutes } from "@/ledgers";
import { AccountRoutes } from "@/ledgers/accounts";
import { LedgerAccountBalanceMonitorRoutes } from "./LedgerAccountBalanceMonitorRoutes";
import { LedgerAccountCategoryRoutes } from "./LedgerAccountCategoryRoutes";
import { LedgerAccountSettlementRoutes } from "./LedgerAccountSettlementRoutes";
import { LedgerAccountStatementRoutes } from "./LedgerAccountStatementRoutes";
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
	await server.register(AccountRoutes, { prefix: "/:ledgerId/accounts" });
	await server.register(LedgerTransactionRoutes, {
		prefix: "/:ledgerId/transactions",
	});
	await server.register(LedgerRoutes);
};

export { LedgerRouterPlugin };
