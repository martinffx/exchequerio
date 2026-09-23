import {
	makeLedgerAccountBalanceMonitorJobWorker,
	makeLedgerAccountBalanceMonitorJobStore,
} from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorJob";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Config } from "@/config";
import { encryptSecret } from "@/lib/crypto";

const config = new Config();
// Validate before starting a worker that could otherwise exhaust jobs with an invalid key.
encryptSecret("", config.balanceMonitorEncryptionKey);
const store = makeLedgerAccountBalanceMonitorJobStore(config.valkeyUrl);
const runtime = ManagedRuntime.make(
	Layer.mergeAll(
		store,
		makeLedgerAccountBalanceMonitorJobWorker(config.balanceMonitorEncryptionKey).pipe(
			Layer.provide(store)
		)
	)
);
let stopping = false;
const stop = () => {
	stopping = true;
	void runtime.dispose();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
	await runtime.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				yield* Effect.logInfo("Balance monitor worker started");
				yield* Effect.never;
			})
		)
	);
} catch {
	if (!stopping) {
		console.error("Balance monitor worker failed");
		process.exitCode = 1;
	}
} finally {
	process.removeListener("SIGTERM", stop);
	process.removeListener("SIGINT", stop);
	await runtime.dispose();
}
