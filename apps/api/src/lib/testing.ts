import { Effect, Layer, type Context } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterEach } from "vitest";
import { signJWT } from "@/auth";
import { Config } from "@/config";
import { AssetServiceTag } from "@/domains/assets/AssetService";
import { AccountServiceTag } from "@/domains/ledgers/accounts/AccountService";
import { LedgerAccountBalanceMonitorServiceTag } from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorService";
import { LedgerAccountCategoryServiceTag } from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryService";
import { LedgerAccountStatementServiceTag } from "@/domains/ledgers/accounts/statements/LedgerAccountStatementService";
import { LedgerServiceTag } from "@/domains/ledgers/LedgerService";
import { LedgerAccountSettlementServiceTag } from "@/domains/ledgers/settlements/LedgerAccountSettlementService";
import { TransactionServiceTag } from "@/domains/ledgers/transactions/LedgerTransactionService";
import { OrganizationServiceTag } from "@/domains/organizations";
import { ServerConfigTag } from "@/runtime";
import { appLayer } from "@/server";

/** The one list of services the HTTP app needs; a new service group is one entry here. */
const serviceTags = {
	organization: OrganizationServiceTag,
	ledger: LedgerServiceTag,
	asset: AssetServiceTag,
	account: AccountServiceTag,
	transaction: TransactionServiceTag,
	settlement: LedgerAccountSettlementServiceTag,
	category: LedgerAccountCategoryServiceTag,
	statement: LedgerAccountStatementServiceTag,
	balanceMonitor: LedgerAccountBalanceMonitorServiceTag,
};
type ServiceTags = typeof serviceTags;
type ServiceKey = keyof ServiceTags;
type ServiceOf<K extends ServiceKey> =
	ServiceTags[K] extends Context.Service<infer _Id, infer S> ? S : never;
type IdOf<K extends ServiceKey> =
	ServiceTags[K] extends Context.Service<infer Id, infer _S> ? Id : never;

/** Every service identifier, as a union (mapped so `IdOf` is applied per key). */
type AllServiceIds = { [K in ServiceKey]: IdOf<K> }[ServiceKey];

/** Plain service stubs, type-checked against the real service interfaces. */
type TestStubs = { readonly [K in ServiceKey]?: ServiceOf<K> };

/** Per-service layer overrides; any service left out is filled by a die-if-called stub. */
type TestServiceLayers = {
	readonly [K in ServiceKey]?: Layer.Layer<IdOf<K>> | undefined;
};

/** A service whose every method dies, so a route test fails loudly if it reaches an unstubbed service. */
const dieIfCalled = (name: string): object =>
	new Proxy(
		{},
		{
			get: (_target, property) => () =>
				Effect.die(new Error(`${name}.${String(property)} called without a test stub`)),
		}
	);

/**
 * Wraps one service implementation in a Layer for its Tag. This is one of three places the file
 * widens a Layer type (the others: the per-key override cast in `testServicesLayer` and the
 * `overrides as TestServiceLayers` cast in `makeTestWebHandler`): the Tags are invariant in their
 * service type, so the table cannot be indexed generically. The widenings are sound because every
 * key of `serviceTags` is iterated, so the merged layer really provides all service ids; filtering
 * keys later would turn a type error into a runtime "service not found".
 */
const provideService = (key: ServiceKey, implementation: object) =>
	Layer.succeed(
		serviceTags[key] as unknown as Context.Service<AllServiceIds, object>,
		implementation
	);

/**
 * Every service the HTTP app needs, plus the server `Config`. Each service defaults to a
 * die-if-called stub unless `overrides` supplies a Layer.
 */
const testServicesLayer = (overrides: TestServiceLayers = {}) =>
	Layer.mergeAll(
		Layer.succeed(ServerConfigTag, new Config()),
		...(Object.keys(serviceTags) as ServiceKey[]).map(
			(key): Layer.Layer<AllServiceIds> =>
				(overrides[key] as Layer.Layer<AllServiceIds> | undefined) ??
				provideService(key, dieIfCalled(serviceTags[key].key))
		)
	);

/** Serves the HTTP app over a web `Request`/`Response` handler with stubbed services and no sockets. */
const makeTestWebHandler = (
	stubs: TestStubs = {},
	/** Extra context for the request fibers, e.g. a capturing `Logger.layer`. */
	extra: Layer.Layer<never> = Layer.empty
) => {
	const overrides: { [K in ServiceKey]?: Layer.Layer<AllServiceIds> } = {};
	for (const key of Object.keys(serviceTags) as ServiceKey[]) {
		const stub = stubs[key];
		if (stub !== undefined) overrides[key] = provideService(key, stub);
	}
	const services = testServicesLayer(overrides as TestServiceLayers);
	return HttpRouter.toWebHandler(Layer.provideMerge(appLayer.pipe(Layer.provide(services)), extra), {
		disableLogger: true,
	});
};

/** Builds scoped bearer tokens for one organization. */
const tokenFor =
	(organizationId: { toString(): string }) => (scope: Parameters<typeof signJWT>[0]["scope"]) =>
		signJWT({ sub: organizationId.toString(), scope });

/** Builds web `Request`s, authenticated with `defaultToken()` unless a token or `anonymous` is given. */
const makeRequest =
	(defaultToken: () => string) =>
	(
		method: string,
		path: string,
		options: {
			token?: string;
			anonymous?: boolean;
			body?: unknown;
			headers?: Record<string, string>;
		} = {}
	) => {
		const token = options.anonymous === true ? undefined : (options.token ?? defaultToken());
		return new Request(`http://localhost${path}`, {
			method,
			headers: {
				...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
				...(options.body === undefined ? {} : { "content-type": "application/json" }),
				...options.headers,
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	};

/** Returns a web handler factory for stubbed services; call at module scope, handlers are disposed after each test. */
const useTestWebHandlers = () => {
	const disposers: Array<() => Promise<void>> = [];
	afterEach(async () => {
		for (const dispose of disposers.splice(0)) await dispose();
	});
	return (stubs: TestStubs) => {
		const { handler, dispose } = makeTestWebHandler(stubs);
		disposers.push(dispose);
		return handler;
	};
};

export type { TestServiceLayers };
export { makeRequest, makeTestWebHandler, testServicesLayer, tokenFor, useTestWebHandlers };
