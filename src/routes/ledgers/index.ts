import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { LedgerRoutes } from "./LedgerRoutes";
import { LedgerAccountRoutes } from "./LedgerAccountRoutes";
import { LedgerTransactionRoutes } from "./LedgerTransactionRoutes";
import { LedgerTransactionEntriesRoutes } from "./LedgerTransactionEntriesRoutes";
import { LedgerAccountCategoryRoutes } from "./LedgerAccountCategoryRoutes";
import { LedgerAccountSettlementRoutes } from "./LedgerAccountSettlementRoutes";
import { LedgerAccountStatementRoutes } from "./LedgerAccountStatementRoutes";
import { LedgerAccountBalanceMonitorRoutes } from "./LedgerAccountBalanceMonitorRoutes";

const LedgerRouterPlugin: FastifyPluginAsync = async (server) => {
	await server.register(LedgerRoutes);
	await server.register(LedgerTransactionRoutes, { prefix: "/transactions" });
	await server.register(LedgerTransactionEntriesRoutes, {
		prefix: "/transactions/entries",
	});
	await server.register(LedgerAccountRoutes, { prefix: "/accounts" });
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
