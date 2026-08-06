import type { IncomingMessage, Server, ServerResponse } from "node:http";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import fastifyUnderPressure from "@fastify/under-pressure";
import fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "@/Auth";
import { Config } from "@/Config";
import { DatabaseTag } from "@/database/Database";
import { globalErrorHandler } from "@/Errors";
import { registerOrganizationRateLimit } from "@/organizations";
import { RepoPlugin, type RepoPluginOptions } from "@/repo";
import { RouterPlugin } from "@/routes";
import { ServicePlugin, type ServicePluginOpts } from "@/services";
import {
	makeServerRuntimeLayer,
	ServerConfigTag,
	ServerRuntime,
	type ServerRuntimeLayer,
	type ServerRuntimeServices,
} from "@/runtime/ServerRuntime";
import { RedisClientTag } from "@/runtime/RedisClient";

type ServerOpts = {
	repoPluginOpts?: Omit<RepoPluginOptions, "db">;
	servicePluginOpts?: ServicePluginOpts;
	runtimeLayer?: ServerRuntimeLayer;
};

declare module "fastify" {
	interface FastifyInstance {
		config: Config;
		runtime: ServerRuntime<ServerRuntimeServices, never>;
	}
}

const buildServer = async ({
	repoPluginOpts,
	servicePluginOpts,
	runtimeLayer,
}: ServerOpts = {}): Promise<FastifyInstance> => {
	const runtime = new ServerRuntime(runtimeLayer ?? makeServerRuntimeLayer(new Config()));
	let runtimeDisposal: Promise<void> | undefined;
	const disposeRuntime = () => (runtimeDisposal ??= runtime.dispose());
	let server: FastifyInstance | undefined;

	try {
		const config = await runtime.runPromise(ServerConfigTag);
		server = fastify<Server, IncomingMessage, ServerResponse>({
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
		server.decorate("runtime", runtime);
		server.addHook("onClose", disposeRuntime);
		server.setErrorHandler(globalErrorHandler);

		// Skip under-pressure in test environment to avoid interference with test execution
		if (config.environment !== "test" && !config.environment.startsWith("test-")) {
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

		await registerAuth(server);
		const { client } = await runtime.runPromise(RedisClientTag);
		await registerOrganizationRateLimit(server, client);
		const { db } = await runtime.runPromise(DatabaseTag);
		await server.register(RepoPlugin, { ...repoPluginOpts, db });
		await server.register(ServicePlugin, servicePluginOpts ?? {});
		await server.register(RouterPlugin, { prefix: "/api" });

		return server;
	} catch (error) {
		if (server !== undefined) {
			try {
				await server.close();
			} catch {
				await disposeRuntime();
			}
		} else {
			await disposeRuntime();
		}
		throw error;
	}
};

export { buildServer };
