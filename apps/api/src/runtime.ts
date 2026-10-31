import { makeLedgerAccountBalanceMonitorJobStore } from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorJob";
import { ledgerAccountBalanceMonitorPublisherLayer } from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorService";
import { Context, Effect, Layer } from "effect";
import { RateLimiter } from "effect/unstable/persistence";
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
import { makeRedisLayer } from "@/lib/queues";

const ServerConfigTag = Context.Service<Config>("ServerConfig");

type ServerRuntimeServices =
	| Config
	| Database
	| Valkey
	| RateLimiter.RateLimiter
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

/** A separate fail-fast connection: a slow or unavailable Valkey must not queue or stall requests. */
const makeRateLimiterLayer = (valkeyUrl: string) =>
	RateLimiter.layer.pipe(
		Layer.provide(RateLimiter.layerStoreRedis({ prefix: "exchequer:ratelimit:" })),
		Layer.provide(makeRedisLayer(valkeyUrl, { enableOfflineQueue: false, commandTimeout: 250 }))
	);

const makeServerRuntimeLayer = (config: Config): ServerRuntimeLayer => {
	const valkey = makeValkeyLive(config.valkeyUrl);
	const idempotency = Layer.unwrap(
		ValkeyTag.pipe(Effect.map(valkey => makeIdempotencyService(valkey.client)))
	).pipe(Layer.provide(valkey));
	const rateLimiter = makeRateLimiterLayer(config.valkeyUrl);
	const infrastructure = Layer.mergeAll(
		Layer.succeed(ServerConfigTag, config),
		makeDatabaseLive(config.databaseUrl),
		valkey,
		idempotency,
		rateLimiter,
		ledgerAccountBalanceMonitorPublisherLayer.pipe(
			Layer.provide(makeLedgerAccountBalanceMonitorJobStore(config.valkeyUrl))
		)
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
		balanceMonitorLayer(config.balanceMonitorEncryptionKey),
		ledgerAccountStatementLayer,
		transactionWithLedger,
		ledgerAccountCategory,
		organizationLayer
	).pipe(Layer.provideMerge(infrastructure));
};

export { makeRateLimiterLayer, makeServerRuntimeLayer, ServerConfigTag };
