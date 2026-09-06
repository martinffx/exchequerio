import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";
import { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
import { LedgerAccountStatementService } from "./LedgerAccountStatementService";

type Services = {
	ledgerAccountCategoryService: LedgerAccountCategoryService;
	ledgerAccountStatementService: LedgerAccountStatementService;
	ledgerAccountBalanceMonitorService: LedgerAccountBalanceMonitorService;
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
		const ledgerAccountStatementService =
			opts.services?.ledgerAccountStatementService ??
			new LedgerAccountStatementService(server.repo.ledgerAccountStatementRepo);
		const ledgerAccountBalanceMonitorService =
			opts.services?.ledgerAccountBalanceMonitorService ??
			new LedgerAccountBalanceMonitorService(server.repo.ledgerAccountBalanceMonitorRepo);
		server.decorate("services", {
			ledgerAccountCategoryService,
			ledgerAccountStatementService,
			ledgerAccountBalanceMonitorService,
		});
	}
);

export * from "@/repo/entities";
export { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";
export { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
export { LedgerAccountStatementService } from "./LedgerAccountStatementService";
export { ServicePlugin, type ServicePluginOpts };
