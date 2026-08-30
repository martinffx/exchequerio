import type { FastifyPluginAsync } from "fastify";
import { LedgerRoutes } from "@/domains/ledgers";
import { AccountRoutes } from "@/domains/ledgers/accounts";
import { LedgerAccountSettlementRoutes } from "@/domains/ledgers/settlements";
import { TransactionRoutes } from "@/domains/ledgers/transactions";
import { LedgerAccountBalanceMonitorRoutes } from "./LedgerAccountBalanceMonitorRoutes";
import { LedgerAccountCategoryRoutes } from "./LedgerAccountCategoryRoutes";
import { LedgerAccountStatementRoutes } from "./LedgerAccountStatementRoutes";

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
	await server.register(TransactionRoutes, {
		prefix: "/:ledgerId/transactions",
	});
	await server.register(LedgerRoutes);
};

export { LedgerRouterPlugin };
