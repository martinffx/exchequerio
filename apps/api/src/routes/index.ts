import type { FastifyPluginAsync } from "fastify";
import { OrganizationRoutes } from "@/organizations";
import { LedgerRouterPlugin } from "./ledgers";

const RouterPlugin: FastifyPluginAsync = async server => {
	server.addHook("preHandler", server.auth([server.verifyJWT]));

	await server.register(OrganizationRoutes, { prefix: "/organizations" });
	await server.register(LedgerRouterPlugin, { prefix: "/ledgers" });
};

export { RouterPlugin };
