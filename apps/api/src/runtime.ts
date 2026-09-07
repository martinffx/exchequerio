import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { Config } from "@/config";
import { type Database, makeDatabaseLive, makeValkeyLive, type Valkey, ValkeyTag } from "@/db";
import { assetServiceLayer, assetRepoLayer, type AssetService } from "@/domains/assets";
import { ledgerLayer, type LedgerService } from "@/domains/ledgers";
import { accountLayer, type AccountService } from "@/domains/ledgers/accounts";
import {
	balanceMonitorLayer,
	type LedgerAccountBalanceMonitorService,
} from "@/domains/ledgers/accounts/balance-monitors";
import {
	ledgerAccountStatementLayer,
	type LedgerAccountStatementService,
} from "@/domains/ledgers/accounts/statements";
import {
	settlementLayer,
	type LedgerAccountSettlementService,
} from "@/domains/ledgers/settlements";
import { transactionLayer, type TransactionService } from "@/domains/ledgers/transactions";
import { organizationLayer, type OrganizationService } from "@/domains/organizations";
import {
	ledgerAccountCategoryLayer,
	type LedgerAccountCategoryService,
} from "@/domains/ledgers/accounts/categories";
import { makeIdempotencyService, type IdempotencyService } from "@/lib/IdempotencyService";

const ServerConfigTag = Context.Service<Config>("ServerConfig");

type ServerRuntimeServices =
	| Config
	| Database
	| Valkey
	| LedgerService
	| AccountService
	| LedgerAccountSettlementService
	| LedgerAccountBalanceMonitorService
	| LedgerAccountStatementService
	| TransactionService
	| IdempotencyService
	| LedgerAccountCategoryService
	| OrganizationService
	| AssetService;

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
	const assetLayer = assetServiceLayer.pipe(Layer.provide(assetRepoLayer));
	const accountWithLedger = accountLayer.pipe(Layer.provide(Layer.merge(ledgerLayer, assetLayer)));
	const transactionWithLedger = transactionLayer.pipe(
		Layer.provide(Layer.merge(ledgerLayer, assetLayer))
	);
	const settlementWithServices = settlementLayer.pipe(
		Layer.provide(Layer.mergeAll(ledgerLayer, accountWithLedger, transactionWithLedger))
	);
	const ledgerAccountCategory = ledgerAccountCategoryLayer.pipe(Layer.provide(ledgerLayer));
	return Layer.mergeAll(
		assetLayer,
		ledgerLayer,
		accountWithLedger,
		settlementWithServices,
		balanceMonitorLayer,
		ledgerAccountStatementLayer,
		transactionWithLedger,
		ledgerAccountCategory,
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
