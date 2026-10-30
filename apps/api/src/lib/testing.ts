import { Effect, Layer, type Context } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterEach } from "vitest";
import { signJWT } from "@/auth";
import { Config } from "@/config";
import { type AssetService, AssetServiceTag } from "@/domains/assets/AssetService";
import { type AccountService, AccountServiceTag } from "@/domains/ledgers/accounts/AccountService";
import {
	type LedgerAccountBalanceMonitorService,
	LedgerAccountBalanceMonitorServiceTag,
} from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorService";
import {
	type LedgerAccountCategoryService,
	LedgerAccountCategoryServiceTag,
} from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryService";
import {
	type LedgerAccountStatementService,
	LedgerAccountStatementServiceTag,
} from "@/domains/ledgers/accounts/statements/LedgerAccountStatementService";
import { type LedgerService, LedgerServiceTag } from "@/domains/ledgers/LedgerService";
import {
	type LedgerAccountSettlementService,
	LedgerAccountSettlementServiceTag,
} from "@/domains/ledgers/settlements/LedgerAccountSettlementService";
import {
	type TransactionService,
	TransactionServiceTag,
} from "@/domains/ledgers/transactions/LedgerTransactionService";
import { type OrganizationService, OrganizationServiceTag } from "@/domains/organizations";
import { ServerConfigTag } from "@/runtime";
import { appLayer } from "@/server";

/** Plain service stubs, type-checked against the real service interfaces. */
type TestStubs = {
	readonly organization?: OrganizationService;
	readonly ledger?: LedgerService;
	readonly asset?: AssetService;
	readonly account?: AccountService;
	readonly transaction?: TransactionService;
	readonly settlement?: LedgerAccountSettlementService;
	readonly category?: LedgerAccountCategoryService;
	readonly statement?: LedgerAccountStatementService;
	readonly balanceMonitor?: LedgerAccountBalanceMonitorService;
};

/** Per-service layer overrides; any service left out is filled by a die-if-called stub. */
type TestServiceLayers = {
	readonly organization?: Layer.Layer<OrganizationService> | undefined;
	readonly ledger?: Layer.Layer<LedgerService> | undefined;
	readonly asset?: Layer.Layer<AssetService> | undefined;
	readonly account?: Layer.Layer<AccountService> | undefined;
	readonly transaction?: Layer.Layer<TransactionService> | undefined;
	readonly settlement?: Layer.Layer<LedgerAccountSettlementService> | undefined;
	readonly category?: Layer.Layer<LedgerAccountCategoryService> | undefined;
	readonly statement?: Layer.Layer<LedgerAccountStatementService> | undefined;
	readonly balanceMonitor?: Layer.Layer<LedgerAccountBalanceMonitorService> | undefined;
};

/** A service whose every method dies, so a route test fails loudly if it reaches an unstubbed service. */
const dieIfCalled = <S>(name: string): S =>
	new Proxy(
		{},
		{
			get: (_target, property) => () =>
				Effect.die(new Error(`${name}.${String(property)} called without a test stub`)),
		}
	) as S;

/** The override when given, otherwise a die-if-called stub for the service. */
const serviceLayer = <S>(tag: Context.Service<S, S>, override?: Layer.Layer<S>) =>
	override ?? Layer.succeed(tag, dieIfCalled<S>(tag.key));

/** Wraps a plain stub in a Layer for its Tag; a missing stub stays missing. */
const stubLayer = <S>(tag: Context.Service<S, S>, stub?: S) =>
	stub === undefined ? undefined : Layer.succeed(tag, stub);

/**
 * Every service the HTTP app needs, plus the server `Config`. Each service defaults to a
 * die-if-called stub unless `overrides` supplies a Layer.
 */
const testServicesLayer = (overrides: TestServiceLayers = {}) =>
	Layer.mergeAll(
		Layer.succeed(ServerConfigTag, new Config()),
		serviceLayer(OrganizationServiceTag, overrides.organization),
		serviceLayer(LedgerServiceTag, overrides.ledger),
		serviceLayer(AssetServiceTag, overrides.asset),
		serviceLayer(AccountServiceTag, overrides.account),
		serviceLayer(TransactionServiceTag, overrides.transaction),
		serviceLayer(LedgerAccountSettlementServiceTag, overrides.settlement),
		serviceLayer(LedgerAccountCategoryServiceTag, overrides.category),
		serviceLayer(LedgerAccountStatementServiceTag, overrides.statement),
		serviceLayer(LedgerAccountBalanceMonitorServiceTag, overrides.balanceMonitor)
	);

/** Serves the HTTP app over a web `Request`/`Response` handler with stubbed services and no sockets. */
const makeTestWebHandler = (
	stubs: TestStubs = {},
	/** Extra context for the request fibers, e.g. a capturing `Logger.layer`. */
	extra: Layer.Layer<never> = Layer.empty
) => {
	const services = testServicesLayer({
		organization: stubLayer(OrganizationServiceTag, stubs.organization),
		ledger: stubLayer(LedgerServiceTag, stubs.ledger),
		asset: stubLayer(AssetServiceTag, stubs.asset),
		account: stubLayer(AccountServiceTag, stubs.account),
		transaction: stubLayer(TransactionServiceTag, stubs.transaction),
		settlement: stubLayer(LedgerAccountSettlementServiceTag, stubs.settlement),
		category: stubLayer(LedgerAccountCategoryServiceTag, stubs.category),
		statement: stubLayer(LedgerAccountStatementServiceTag, stubs.statement),
		balanceMonitor: stubLayer(LedgerAccountBalanceMonitorServiceTag, stubs.balanceMonitor),
	});
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
			/** A body sent verbatim, for malformed or non-JSON payloads; set `content-type` in `headers`. */
			rawBody?: string;
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
			body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
		});
	};

/** Returns a web handler factory for stubbed services; call at module scope, handlers are disposed after each test. */
const useTestWebHandlers = () => {
	const disposers: Array<() => Promise<void>> = [];
	afterEach(async () => {
		for (const dispose of disposers.splice(0)) await dispose();
	});
	return (stubs: TestStubs, extra?: Layer.Layer<never>) => {
		const { handler, dispose } = makeTestWebHandler(stubs, extra);
		disposers.push(dispose);
		return handler;
	};
};

export type { TestServiceLayers };
export { makeRequest, makeTestWebHandler, testServicesLayer, tokenFor, useTestWebHandlers };
