import { drizzle } from "drizzle-orm/node-postgres"
import type { FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import { LedgerAccountRepo } from "./LedgerAccountRepo"
import { LedgerRepo } from "./LedgerRepo"
import { LedgerTransactionRepo } from "./LedgerTransactionRepo"
import { OrganizationRepo } from "./OrganizationRepo"
import * as schema from "./schema"

interface Repos {
	organizationRepo: OrganizationRepo
	ledgerRepo: LedgerRepo
	ledgerAccountRepo: LedgerAccountRepo
	ledgerTransactionRepo: LedgerTransactionRepo
}

declare module "fastify" {
	interface FastifyInstance {
		repo: Repos
	}
}

const RepoPlugin: FastifyPluginAsync = fp(server => {
	const database = drizzle(server.config.databaseUrl, { schema })
	const organizationRepo = new OrganizationRepo(database)
	const ledgerRepo = new LedgerRepo(database)
	const ledgerAccountRepo = new LedgerAccountRepo(database)
	const ledgerTransactionRepo = new LedgerTransactionRepo(database)
	const repos: Repos = {
		organizationRepo,
		ledgerRepo,
		ledgerAccountRepo,
		ledgerTransactionRepo,
	}
	server.decorate("repo", repos)
})

export { RepoPlugin }
