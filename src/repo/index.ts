import { drizzle } from "drizzle-orm/node-postgres"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import { LedgerAccountRepo } from "./LedgerAccountRepo"
import { LedgerRepo } from "./LedgerRepo"
import { LedgerTransactionRepo } from "./LedgerTransactionRepo"
import { OrganizationRepo } from "./OrganizationRepo"
import * as schema from "./schema"
import type { DrizzleDB } from "./types"

type Repos = {
	organizationRepo: OrganizationRepo
	ledgerRepo: LedgerRepo
	ledgerAccountRepo: LedgerAccountRepo
	ledgerTransactionRepo: LedgerTransactionRepo
}

type RepoPluginOptions = {
	db?: DrizzleDB
	repos?: Partial<Repos>
}

declare module "fastify" {
	interface FastifyInstance {
		repo: Repos
	}
}

const RepoPlugin: FastifyPluginAsync<RepoPluginOptions> = fp(
	async (server: FastifyInstance, opts: RepoPluginOptions): Promise<void> => {
		const db = opts.db ?? drizzle(server.config.databaseUrl, { schema })
		const organizationRepo = opts.repos?.organizationRepo ?? new OrganizationRepo(db)
		const ledgerRepo = opts.repos?.ledgerRepo ?? new LedgerRepo(db)
		const ledgerAccountRepo = opts.repos?.ledgerAccountRepo ?? new LedgerAccountRepo(db)
		const ledgerTransactionRepo = opts.repos?.ledgerTransactionRepo ?? new LedgerTransactionRepo(db)
		const repos: Repos = {
			organizationRepo,
			ledgerRepo,
			ledgerAccountRepo,
			ledgerTransactionRepo,
		}
		server.decorate("repo", repos)
	}
)

export { RepoPlugin, type RepoPluginOptions }
