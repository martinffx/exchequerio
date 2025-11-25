import type { FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import { LedgerService } from "./LedgerService"
import { LedgerAccountService } from "./LedgerAccountService"
import { LedgerTransactionService } from "./LedgerTransactionService"
import { OrganizationService } from "./OrganizationService"

interface Services {
	ledgerService: LedgerService
	ledgerAccountService: LedgerAccountService
	ledgerTransactionService: LedgerTransactionService
	organizationService: OrganizationService
}

declare module "fastify" {
	interface FastifyInstance {
		services: Services
	}
}

const ServicePlugin: FastifyPluginAsync = fp(async server => {
	const organizationService = new OrganizationService(server.repo.organizationRepo)
	const ledgerService = new LedgerService(server.repo.ledgerRepo)
	const ledgerAccountService = new LedgerAccountService(server.repo.ledgerRepo)
	const ledgerTransactionService = new LedgerTransactionService(server.repo.ledgerRepo)
	server.decorate("services", {
		organizationService,
		ledgerService,
		ledgerAccountService,
		ledgerTransactionService,
	})
})

export * from "./entities"
export { ServicePlugin }
