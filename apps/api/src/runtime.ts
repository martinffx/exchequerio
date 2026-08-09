import { Context, type Effect, Layer, ManagedRuntime } from "effect";
import type { Config } from "@/config";
import { type Database, makeDatabaseLive } from "@/db";
import { ledgerLayer, type LedgerService } from "@/ledgers";
import { accountLayer, type AccountService } from "@/ledgers/accounts";
import { organizationLayer, type OrganizationService } from "@/organizations";

const ServerConfigTag = Context.Service<Config>("ServerConfig");

type ServerRuntimeServices =
	| Config
	| Database
	| LedgerService
	| AccountService
	| OrganizationService;

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
	const accountWithLedger = accountLayer.pipe(Layer.provide(ledgerLayer));
	return Layer.mergeAll(ledgerLayer, accountWithLedger, organizationLayer).pipe(
		Layer.provideMerge(infrastructure)
	);
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
