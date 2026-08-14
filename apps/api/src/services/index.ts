import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";
import { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
import { LedgerAccountSettlementService } from "./LedgerAccountSettlementService";
import { LedgerAccountStatementService } from "./LedgerAccountStatementService";
import { LedgerTransactionService } from "./LedgerTransactionService";

type Services = {
	ledgerAccountCategoryService: LedgerAccountCategoryService;
	ledgerAccountSettlementService: LedgerAccountSettlementService;
	ledgerAccountStatementService: LedgerAccountStatementService;
	ledgerAccountBalanceMonitorService: LedgerAccountBalanceMonitorService;
	ledgerTransactionService: LedgerTransactionService;
};

type ServicePluginOpts = {
	services?: Partial<Services>;
};

declare module "fastify" {
	interface FastifyInstance {
		services: Services;
	}
}

const ServicePlugin: FastifyPluginAsync<ServicePluginOpts> = fp(
	async (server: FastifyInstance, opts: ServicePluginOpts) => {
		const ledgerAccountCategoryService =
			opts.services?.ledgerAccountCategoryService ??
			new LedgerAccountCategoryService(server.repo.ledgerAccountCategoryRepo);
		const ledgerTransactionService =
			opts.services?.ledgerTransactionService ??
			new LedgerTransactionService(server.repo.ledgerTransactionRepo, server.repo.ledgerAccountReader);
		const ledgerAccountSettlementService =
			opts.services?.ledgerAccountSettlementService ??
			new LedgerAccountSettlementService(
				server.repo.ledgerAccountSettlementRepo,
				ledgerTransactionService
			);
		const ledgerAccountStatementService =
			opts.services?.ledgerAccountStatementService ??
			new LedgerAccountStatementService(server.repo.ledgerAccountStatementRepo);
		const ledgerAccountBalanceMonitorService =
			opts.services?.ledgerAccountBalanceMonitorService ??
			new LedgerAccountBalanceMonitorService(server.repo.ledgerAccountBalanceMonitorRepo);
		server.decorate("services", {
			ledgerAccountCategoryService,
			ledgerAccountSettlementService,
			ledgerAccountStatementService,
			ledgerAccountBalanceMonitorService,
			ledgerTransactionService,
		});
	}
);

export * from "@/repo/entities";
export { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";
export { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
export { LedgerAccountSettlementService } from "./LedgerAccountSettlementService";
export { LedgerAccountStatementService } from "./LedgerAccountStatementService";
export { LedgerTransactionService } from "./LedgerTransactionService";
export { ServicePlugin, type ServicePluginOpts };
