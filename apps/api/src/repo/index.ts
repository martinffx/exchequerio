import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { LedgerAccountBalanceMonitorRepo } from "./LedgerAccountBalanceMonitorRepo";
import { LedgerAccountCategoryRepo } from "./LedgerAccountCategoryRepo";
import { LedgerAccountReader } from "./LedgerAccountReader";
import { LedgerAccountSettlementRepo } from "./LedgerAccountSettlementRepo";
import { LedgerAccountStatementRepo } from "./LedgerAccountStatementRepo";
import { LedgerTransactionRepo } from "./LedgerTransactionRepo";
import type { RepoPluginOptions, Repos } from "./types";

declare module "fastify" {
	interface FastifyInstance {
		repo: Repos;
	}
}

const RepoPlugin: FastifyPluginAsync<RepoPluginOptions> = fp(
	async (server: FastifyInstance, opts: RepoPluginOptions): Promise<void> => {
		const { db } = opts;

		const ledgerAccountReader = opts.repos?.ledgerAccountReader ?? new LedgerAccountReader(db);
		const ledgerAccountCategoryRepo =
			opts.repos?.ledgerAccountCategoryRepo ?? new LedgerAccountCategoryRepo(db);
		const ledgerAccountSettlementRepo =
			opts.repos?.ledgerAccountSettlementRepo ?? new LedgerAccountSettlementRepo(db);
		const ledgerAccountStatementRepo =
			opts.repos?.ledgerAccountStatementRepo ?? new LedgerAccountStatementRepo(db);
		const ledgerAccountBalanceMonitorRepo =
			opts.repos?.ledgerAccountBalanceMonitorRepo ?? new LedgerAccountBalanceMonitorRepo(db);
		const ledgerTransactionRepo = opts.repos?.ledgerTransactionRepo ?? new LedgerTransactionRepo(db);
		const repos: Repos = {
			ledgerAccountReader,
			ledgerAccountCategoryRepo,
			ledgerAccountSettlementRepo,
			ledgerAccountStatementRepo,
			ledgerAccountBalanceMonitorRepo,
			ledgerTransactionRepo,
		};
		server.decorate("repo", repos);
	}
);

export { RepoPlugin };
export type { RepoPluginOptions, Repos } from "./types";
