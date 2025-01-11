import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { OrganizationRepo } from "./OrganizationRepo";
import * as schema from "./schema";
import { LedgerRepo } from "./LedgerRepo";

type Repos = {
	organizationRepo: OrganizationRepo;
	ledgerRepo: LedgerRepo;
};

declare module "fastify" {
	interface FastifyInstance {
		repo: Repos;
	}
}

const RepoPlugin: FastifyPluginAsync = fp(async (server) => {
	const db = drizzle(server.config.databaseUrl, { schema });
	const organizationRepo = new OrganizationRepo(db);
	const ledgerRepo = new LedgerRepo(db);
	const repos: Repos = {
		organizationRepo,
		ledgerRepo,
	};
	server.decorate("repo", repos);
});

export { RepoPlugin };
