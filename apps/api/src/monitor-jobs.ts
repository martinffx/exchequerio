import { makeLedgerAccountBalanceMonitorJobStore } from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorJob";
import { ManagedRuntime } from "effect";
import { inspectBalanceMonitorJob } from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorService";
import { Config } from "@/config";

const [command, rawId, ...extra] = process.argv.slice(2);
if (!rawId || !["inspect", "replay"].includes(command ?? "") || extra.length) {
	console.error("Usage: monitor:jobs <inspect|replay> <jobId>");
	process.exitCode = 1;
} else {
	const runtime = ManagedRuntime.make(
		makeLedgerAccountBalanceMonitorJobStore(new Config().valkeyUrl)
	);
	try {
		const result = await runtime.runPromise(inspectBalanceMonitorJob(rawId, command === "replay"));
		console.log(JSON.stringify(result, undefined, 2));
	} catch {
		console.error("Monitor job operation failed: verify the ID, state and Valkey connection");
		process.exitCode = 1;
	} finally {
		await runtime.dispose();
	}
}
