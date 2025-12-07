import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";
import { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
import { LedgerAccountService } from "./LedgerAccountService";
import { LedgerAccountSettlementService } from "./LedgerAccountSettlementService";
import { LedgerAccountStatementService } from "./LedgerAccountStatementService";
import { LedgerService } from "./LedgerService";
import { LedgerTransactionService } from "./LedgerTransactionService";
import { OrganizationService } from "./OrganizationService";

type Services = {
	ledgerService: LedgerService;
	ledgerAccountService: LedgerAccountService;
	ledgerAccountCategoryService: LedgerAccountCategoryService;
	ledgerAccountSettlementService: LedgerAccountSettlementService;
	ledgerAccountStatementService: LedgerAccountStatementService;
	ledgerAccountBalanceMonitorService: LedgerAccountBalanceMonitorService;
	ledgerTransactionService: LedgerTransactionService;
	organizationService: OrganizationService;
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
		const organizationService =
			opts.services?.organizationService ?? new OrganizationService(server.repo.organizationRepo);
		const ledgerService = opts.services?.ledgerService ?? new LedgerService(server.repo.ledgerRepo);
		const ledgerAccountService =
			opts.services?.ledgerAccountService ??
			new LedgerAccountService(server.repo.ledgerAccountRepo, server.repo.ledgerRepo);
		const ledgerAccountCategoryService =
			opts.services?.ledgerAccountCategoryService ??
			new LedgerAccountCategoryService(server.repo.ledgerAccountCategoryRepo);
		const ledgerAccountSettlementService =
			opts.services?.ledgerAccountSettlementService ??
			new LedgerAccountSettlementService(
				server.repo.ledgerAccountSettlementRepo,
				server.repo.ledgerRepo
			);
		const ledgerAccountStatementService =
			opts.services?.ledgerAccountStatementService ??
			new LedgerAccountStatementService(server.repo.ledgerAccountStatementRepo);
		const ledgerAccountBalanceMonitorService =
			opts.services?.ledgerAccountBalanceMonitorService ??
			new LedgerAccountBalanceMonitorService(server.repo.ledgerAccountBalanceMonitorRepo);
		const ledgerTransactionService =
			opts.services?.ledgerTransactionService ??
			new LedgerTransactionService(server.repo.ledgerTransactionRepo, server.repo.ledgerRepo);
		server.decorate("services", {
			organizationService,
			ledgerService,
			ledgerAccountService,
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
export { LedgerAccountService } from "./LedgerAccountService";
export { LedgerAccountSettlementService } from "./LedgerAccountSettlementService";
export { LedgerAccountStatementService } from "./LedgerAccountStatementService";
export { LedgerService } from "./LedgerService";
export { LedgerTransactionService } from "./LedgerTransactionService";
export { OrganizationService } from "./OrganizationService";
export { ServicePlugin, type ServicePluginOpts };
