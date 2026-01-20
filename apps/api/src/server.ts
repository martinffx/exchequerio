import type { IncomingMessage, Server, ServerResponse } from "node:http";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import fastifyUnderPressure from "@fastify/under-pressure";
import fastify, { type FastifyInstance } from "fastify";
import { type AuthOptions, registerAuth } from "@/auth";
import { Config } from "@/config";
import { globalErrorHandler } from "@/errors";
import { RepoPlugin, type RepoPluginOptions } from "@/repo";
import { RouterPlugin } from "@/routes";
import { ServicePlugin, type ServicePluginOpts } from "@/services";

type ServerOpts = {
	repoPluginOpts?: RepoPluginOptions;
	servicePluginOpts?: ServicePluginOpts;
	authOpts?: AuthOptions;
};

declare module "fastify" {
	interface FastifyInstance {
		config: Config;
	}
}

const buildServer = async ({
	repoPluginOpts,
	servicePluginOpts,
	authOpts,
}: ServerOpts = {}): Promise<FastifyInstance> => {
	const config = new Config();
	const server = fastify<Server, IncomingMessage, ServerResponse>({
	  forceCloseConnections: true,
		logger: {
			transport: {
				targets: [
					{
						target: "pino-pretty",
						level: "debug",
						options: {
							colorize: true,
						},
					},
				],
			},
		},
	});
	server.decorate("config", config);
	server.setErrorHandler(globalErrorHandler);

	// Skip under-pressure in test environment to avoid interference with test execution
	if (config.environment !== "test") {
		await server.register(fastifyUnderPressure, {
			maxEventLoopDelay: 1000,
			maxHeapUsedBytes: 500_000_000,
			maxRssBytes: 1_000_000_000,
			maxEventLoopUtilization: 0.9,
			retryAfter: 50,
			exposeStatusRoute: true,
		});
	}

	server.get("/health", (_request, reply) => {
		reply.send({}).code(200);
	});

	await server.register(fastifySwagger, {
		openapi: {
			openapi: "3.0.0",
			info: {
				title: "Ledger API",
				description: "An API for ledger accounts",
				version: "0.1.0",
			},
			servers: [
				{
					url: "http://localhost:3000",
					description: "Development server",
				},
			],
			tags: [
				{
					name: "Organizations",
					description: "An organization is a tenant on the platform.",
				},
				{
					name: "Ledgers",
					description: "A ledger represents a standard chart of ledger accounts.",
				},
			],
			components: {
				securitySchemes: {
					bearerAuth: {
						type: "apiKey",
						name: "Authorization",
						in: "header",
					},
				},
			},
		},
	});
	await server.register(fastifySwaggerUI, {
		routePrefix: "/docs",
		uiConfig: {
			docExpansion: "list",
			deepLinking: false,
		},
	});

	await registerAuth(server, authOpts ?? {});
	await server.register(RepoPlugin, repoPluginOpts ?? {});
	await server.register(ServicePlugin, servicePluginOpts ?? {});
	await server.register(RouterPlugin, { prefix: "/api" });

	return server;
};

export { buildServer };
