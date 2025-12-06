import { drizzle } from "drizzle-orm/node-postgres";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { LedgerAccountCategoryRepo } from "./LedgerAccountCategoryRepo";
import { LedgerAccountRepo } from "./LedgerAccountRepo";
import { LedgerAccountSettlementRepo } from "./LedgerAccountSettlementRepo";
import { LedgerRepo } from "./LedgerRepo";
import { LedgerTransactionRepo } from "./LedgerTransactionRepo";
import { OrganizationRepo } from "./OrganizationRepo";
import * as schema from "./schema";
import type { RepoPluginOptions, Repos } from "./types";

declare module "fastify" {
	interface FastifyInstance {
		repo: Repos;
	}
}

const RepoPlugin: FastifyPluginAsync<RepoPluginOptions> = fp(
	async (server: FastifyInstance, opts: RepoPluginOptions): Promise<void> => {
		const db = opts.db ?? drizzle(server.config.databaseUrl, { schema });
		const organizationRepo = opts.repos?.organizationRepo ?? new OrganizationRepo(db);
		const ledgerRepo = opts.repos?.ledgerRepo ?? new LedgerRepo(db);
		const ledgerAccountRepo = opts.repos?.ledgerAccountRepo ?? new LedgerAccountRepo(db);
		const ledgerAccountCategoryRepo =
			opts.repos?.ledgerAccountCategoryRepo ?? new LedgerAccountCategoryRepo(db);
		const ledgerAccountSettlementRepo =
			opts.repos?.ledgerAccountSettlementRepo ?? new LedgerAccountSettlementRepo(db);
		const ledgerTransactionRepo = opts.repos?.ledgerTransactionRepo ?? new LedgerTransactionRepo(db);
		const repos: Repos = {
			organizationRepo,
			ledgerRepo,
			ledgerAccountRepo,
			ledgerAccountCategoryRepo,
			ledgerAccountSettlementRepo,
			ledgerTransactionRepo,
		};
		server.decorate("repo", repos);
	}
);

export { RepoPlugin };
export type { RepoPluginOptions, Repos } from "./types";
