import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
// oxlint-disable-next-line boundaries/element-types -- The legacy ServicePlugin adapts the integrated Ledger service during the in-place Category migration.
import { LedgerServiceTag } from "@/domains/ledgers";
import { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
import { LedgerAccountStatementService } from "./LedgerAccountStatementService";

type Services = {
	ledgerAccountCategoryService: LedgerAccountCategoryService;
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
		const ledgerAccountCategoryService =
			opts.services?.ledgerAccountCategoryService ??
			new LedgerAccountCategoryService(server.repo.ledgerAccountCategoryRepo, {
				getLedger: (organizationId, ledgerId) =>
					server.runtime.runPromise(
						LedgerServiceTag.use(service => service.getLedger(organizationId, ledgerId))
					),
			});
		const ledgerAccountStatementService =
			opts.services?.ledgerAccountStatementService ??
			new LedgerAccountStatementService(server.repo.ledgerAccountStatementRepo);
		server.decorate("services", {
			ledgerAccountCategoryService,
			ledgerAccountStatementService,
		});
	}
);

export * from "@/repo/entities";
export { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
export { LedgerAccountStatementService } from "./LedgerAccountStatementService";
export { ServicePlugin, type ServicePluginOpts };
