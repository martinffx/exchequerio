import type { Server, IncomingMessage, ServerResponse } from "node:http";
import fastify, { type FastifyInstance } from "fastify";
import fastifyUnderPressure from "@fastify/under-pressure";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";

import { RouterPlugin } from "@/routes";
import { Config } from "@/config";
import { RepoPlugin } from "@/repo";
import { ServicePlugin } from "@/services";
import { globalErrorHandler } from "@/errors";
import { registerAuth } from "@/auth";

declare module "fastify" {
	interface FastifyInstance {
		config: Config;
	}
}

const buildServer = async (): Promise<FastifyInstance> => {
	const config = new Config();
	const server = fastify<Server, IncomingMessage, ServerResponse>({
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

	await server.register(fastifyUnderPressure, {
		maxEventLoopDelay: 10000,
		maxHeapUsedBytes: 1000000000,
		maxRssBytes: 1000000000,
		maxEventLoopUtilization: 0.98,
	});

	server.get("/health", (_req, reply) => {
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
					description:
						"A ledger represents a standard chart of ledger accounts.",
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

	await registerAuth(server);
	await server.register(RepoPlugin);
	await server.register(ServicePlugin);
	await server.register(RouterPlugin, { prefix: "/api" });

	return server;
};

export { buildServer };
