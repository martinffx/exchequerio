import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

type Services = Record<string, never>;

type ServicePluginOpts = {
	services?: Partial<Services>;
};

declare module "fastify" {
	interface FastifyInstance {
		services: Services;
	}
}

const ServicePlugin: FastifyPluginAsync<ServicePluginOpts> = fp(async (server: FastifyInstance) => {
	server.decorate("services", {});
});

export * from "@/repo/entities";
export { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";
export { ServicePlugin, type ServicePluginOpts };
