import type { IncomingMessage, Server, ServerResponse } from "node:http";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import fastifyUnderPressure from "@fastify/under-pressure";
import fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import { registerAuth } from "@/auth";
import { Config } from "@/config";
import { globalErrorHandler } from "@/lib/errors";
import {
	makeServerRuntimeLayer,
	ServerConfigTag,
	ServerRuntime,
	type ServerRuntimeLayer,
	type ServerRuntimeServices,
} from "@/runtime";
import { OrganizationRoutes } from "@/domains/organizations";
import { LedgerRoutes } from "@/domains/ledgers";
import { AccountRoutes } from "@/domains/ledgers/accounts";
import { LedgerAccountBalanceMonitorRoutes } from "@/domains/ledgers/accounts/balance-monitors";
import { LedgerAccountStatementRoutes } from "@/domains/ledgers/accounts/statements";
import { LedgerAccountSettlementRoutes } from "@/domains/ledgers/settlements";
import { TransactionRoutes } from "@/domains/ledgers/transactions";
import { LedgerAccountCategoryRoutes } from "@/domains/ledgers/accounts/categories";

const LedgerRouterPlugin: FastifyPluginAsync = async server => {
	await server.register(LedgerAccountCategoryRoutes, {
		prefix: "/:ledgerId/accounts/categories",
	});
	await server.register(LedgerAccountSettlementRoutes, {
		prefix: "/:ledgerId/settlements",
	});
	await server.register(LedgerAccountStatementRoutes, {
		prefix: "/:ledgerId/accounts/:accountId/statements",
	});
	await server.register(LedgerAccountBalanceMonitorRoutes, {
		prefix: "/:ledgerId/accounts/:accountId/balance-monitors",
	});
	await server.register(AccountRoutes, { prefix: "/:ledgerId/accounts" });
	await server.register(TransactionRoutes, {
		prefix: "/:ledgerId/transactions",
	});
	await server.register(LedgerRoutes);
};

const RouterPlugin: FastifyPluginAsync = async server => {
	server.addHook("preHandler", server.auth([server.verifyJWT]));

	await server.register(OrganizationRoutes, { prefix: "/organizations" });
	await server.register(LedgerRouterPlugin, { prefix: "/ledgers" });
};

type ServerOpts = {
	runtimeLayer?: ServerRuntimeLayer;
};

declare module "fastify" {
	interface FastifyInstance {
		config: Config;
		runtime: ServerRuntime<ServerRuntimeServices, never>;
	}
}

const buildServer = async ({ runtimeLayer }: ServerOpts = {}): Promise<FastifyInstance> => {
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
