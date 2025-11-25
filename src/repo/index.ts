import type { FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { OrganizationRepo } from "./OrganizationRepo"
import { LedgerAccountRepo } from "./LedgerAccountRepo"
import { LedgerTransactionRepo } from "./LedgerTransactionRepo"
import * as schema from "./schema"
import { LedgerRepo } from "./LedgerRepo"

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

const RepoPlugin: FastifyPluginAsync = fp(async server => {
	const db = drizzle(server.config.databaseUrl, { schema })
	const organizationRepo = new OrganizationRepo(db)
	const ledgerRepo = new LedgerRepo(db)
	const ledgerAccountRepo = new LedgerAccountRepo(db)
	const ledgerTransactionRepo = new LedgerTransactionRepo(db)
	const repos: Repos = {
		organizationRepo,
		ledgerRepo,
		ledgerAccountRepo,
		ledgerTransactionRepo,
	}
	server.decorate("repo", repos)
})

export { RepoPlugin }
