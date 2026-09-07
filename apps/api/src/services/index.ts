import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { LedgerAccountStatementService } from "./LedgerAccountStatementService";

type Services = {
	ledgerAccountStatementService: LedgerAccountStatementService;
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
		const ledgerAccountStatementService =
			opts.services?.ledgerAccountStatementService ??
			new LedgerAccountStatementService(server.repo.ledgerAccountStatementRepo);
		server.decorate("services", {
			ledgerAccountStatementService,
		});
	}
);

export * from "@/repo/entities";
export { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
export { LedgerAccountStatementService } from "./LedgerAccountStatementService";
export { ServicePlugin, type ServicePluginOpts };
