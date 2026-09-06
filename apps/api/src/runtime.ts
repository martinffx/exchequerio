import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { Config } from "@/config";
import { type Database, makeDatabaseLive, makeValkeyLive, type Valkey, ValkeyTag } from "@/db";
import { ledgerLayer, type LedgerService } from "@/domains/ledgers";
import { accountLayer, type AccountService } from "@/domains/ledgers/accounts";
import {
	settlementLayer,
	type LedgerAccountSettlementService,
} from "@/domains/ledgers/settlements";
import { transactionLayer, type TransactionService } from "@/domains/ledgers/transactions";
import { organizationLayer, type OrganizationService } from "@/domains/organizations";
import { makeIdempotencyService, type IdempotencyService } from "@/services/IdempotencyService";

const ServerConfigTag = Context.Service<Config>("ServerConfig");

type ServerRuntimeServices =
	| Config
	| Database
	| Valkey
	| LedgerService
	| AccountService
	| LedgerAccountSettlementService
	| TransactionService
	| IdempotencyService
	| OrganizationService;

type ServerRuntimeLayer = Layer.Layer<ServerRuntimeServices, never, never>;

interface ServerRuntimeLayerOverrides {
	readonly database?: Layer.Layer<Database, never, never>;
	readonly idempotency?: Layer.Layer<IdempotencyService, never, never>;
}

const makeServerRuntimeLayer = (
	config: Config,
	overrides: ServerRuntimeLayerOverrides = {}
): ServerRuntimeLayer => {
	const valkey = makeValkeyLive(config.valkeyUrl);
	const idempotency =
		overrides.idempotency ??
		Layer.unwrap(ValkeyTag.pipe(Effect.map(valkey => makeIdempotencyService(valkey.client)))).pipe(
			Layer.provide(valkey)
		);
	const infrastructure = Layer.mergeAll(
		Layer.succeed(ServerConfigTag, config),
		overrides.database ?? makeDatabaseLive(config.databaseUrl),
		valkey,
		idempotency
	);
	const accountWithLedger = accountLayer.pipe(Layer.provide(ledgerLayer));
	const transactionWithLedger = transactionLayer.pipe(Layer.provide(ledgerLayer));
	const settlementWithServices = settlementLayer.pipe(
		Layer.provide(Layer.mergeAll(ledgerLayer, accountWithLedger, transactionWithLedger))
	);
	return Layer.mergeAll(
		ledgerLayer,
		accountWithLedger,
		settlementWithServices,
		transactionWithLedger,
		organizationLayer
	).pipe(Layer.provideMerge(infrastructure));
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
