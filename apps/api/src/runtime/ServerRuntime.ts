import { Context, type Effect, Layer, ManagedRuntime } from "effect";
import type { Config } from "../Config";
import { type Database, makeDatabaseLive } from "../db/Database";
import { organizationLayer, type OrganizationService } from "../organizations";

const ServerConfigTag = Context.Service<Config>("ServerConfig");

type ServerRuntimeServices = Config | Database | OrganizationService;

type ServerRuntimeLayer = Layer.Layer<ServerRuntimeServices, never, never>;

interface ServerRuntimeLayerOverrides {
	readonly database?: Layer.Layer<Database, never, never>;
}

const makeServerRuntimeLayer = (
	config: Config,
	overrides: ServerRuntimeLayerOverrides = {}
): ServerRuntimeLayer => {
	const infrastructure = Layer.mergeAll(
		Layer.succeed(ServerConfigTag, config),
		overrides.database ?? makeDatabaseLive(config.databaseUrl)
	);
	return organizationLayer.pipe(Layer.provideMerge(infrastructure));
};

class ServerRuntime<R, ER> {
	private readonly runtime: ManagedRuntime.ManagedRuntime<R, ER>;
	private disposal: Promise<void> | undefined;

	constructor(layer: Layer.Layer<R, ER, never>) {
		this.runtime = ManagedRuntime.make(layer);
	}

	runPromise<A, E>(effect: Effect.Effect<A, E, R>): Promise<A> {
		return this.runtime.runPromise(effect);
	}

	dispose(): Promise<void> {
		return (this.disposal ??= this.runtime.dispose());
	}
}

export type { ServerRuntimeLayer, ServerRuntimeLayerOverrides, ServerRuntimeServices };
export { makeServerRuntimeLayer, ServerConfigTag, ServerRuntime };
