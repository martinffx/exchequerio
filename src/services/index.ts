import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { LedgerAccountService } from "./LedgerAccountService";
import { LedgerService } from "./LedgerService";
import { LedgerTransactionService } from "./LedgerTransactionService";
import { OrganizationService } from "./OrganizationService";

type Services = {
	ledgerService: LedgerService;
	ledgerAccountService: LedgerAccountService;
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
		const ledgerTransactionService =
			opts.services?.ledgerTransactionService ??
			new LedgerTransactionService(server.repo.ledgerTransactionRepo);
		server.decorate("services", {
			organizationService,
			ledgerService,
			ledgerAccountService,
			ledgerTransactionService,
		});
	}
);

export * from "./entities";
export { ServicePlugin, type ServicePluginOpts };
