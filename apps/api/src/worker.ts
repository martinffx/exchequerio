import { Effect, Layer, ManagedRuntime } from "effect";
import { Config } from "@/config";
import { DatabaseTag, makeDatabaseLive } from "@/db";
import { encryptToken } from "@/domains/ledgers/accounts/balance-monitors/MonitorSecrets";
import { makeMonitorDeliveryWorker } from "@/jobs/MonitorDelivery";
import { MonitorOutboxRepoLive } from "@/jobs/MonitorOutboxRepo";
import { makeMonitorJobStore } from "@/jobs/MonitorQueue";
import { runMonitorRelay } from "@/jobs/MonitorRelay";

const config = new Config();
// Validate before starting a worker that could otherwise exhaust jobs with an invalid key.
encryptToken("", config.balanceMonitorEncryptionKey);
const store = makeMonitorJobStore(config.valkeyUrl);
const runtime = ManagedRuntime.make(
	Layer.mergeAll(
		makeDatabaseLive(config.databaseUrl),
		store,
		makeMonitorDeliveryWorker(config.balanceMonitorEncryptionKey).pipe(Layer.provide(store))
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
				const database = yield* DatabaseTag;
				yield* Effect.logInfo("Balance monitor worker started");
				yield* runMonitorRelay(new MonitorOutboxRepoLive(database.effectDb), config.databaseUrl);
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
