import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { LedgerAccountCategoryRepo } from "./LedgerAccountCategoryRepo";
import { LedgerAccountStatementRepo } from "./LedgerAccountStatementRepo";
import type { RepoPluginOptions, Repos } from "./types";

declare module "fastify" {
	interface FastifyInstance {
		repo: Repos;
	}
}

const RepoPlugin: FastifyPluginAsync<RepoPluginOptions> = fp(
	async (server: FastifyInstance, opts: RepoPluginOptions): Promise<void> => {
		const { db } = opts;

		const ledgerAccountCategoryRepo =
			opts.repos?.ledgerAccountCategoryRepo ?? new LedgerAccountCategoryRepo(db);
		const ledgerAccountStatementRepo =
			opts.repos?.ledgerAccountStatementRepo ?? new LedgerAccountStatementRepo(db);
		const repos: Repos = {
			ledgerAccountCategoryRepo,
			ledgerAccountStatementRepo,
		};
		server.decorate("repo", repos);
	}
);

export { RepoPlugin };
export type { RepoPluginOptions, Repos } from "./types";
