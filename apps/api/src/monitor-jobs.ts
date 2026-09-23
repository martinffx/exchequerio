import {
	LedgerAccountBalanceMonitorJob,
	makeLedgerAccountBalanceMonitorJobStore,
} from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorJob";
import { Effect, ManagedRuntime, Option } from "effect";
import { JobStore } from "effect-mq";
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
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const store = yield* JobStore.JobStore;
				const id = JobStore.JobId(rawId);
				const found = yield* store.getJob(id);
				if (
					Option.isNone(found) ||
					found.value.name !== "balance-monitor-delivery" ||
					found.value.queue !== "balance-monitor-delivery"
				) {
					return yield* Effect.fail("Monitor job not found");
				}
				const job = found.value;
				if (command === "replay") {
					if (job.state !== "failed")
						return yield* Effect.fail("Only failed monitor jobs can be replayed");
					yield* LedgerAccountBalanceMonitorJob.retry(id);
					return { id, replayed: true };
				}
				// Allowlist operational fields: never print payload, credentials, or arbitrary stored errors.
				return {
					id,
					state: job.state,
					attemptsMade: job.attemptsMade,
					attemptsMax: job.attemptsMax,
					enqueuedAt: job.enqueuedAt,
					processedAt: job.processedAt,
					finishedAt: job.finishedAt,
				};
			})
		);
		console.log(JSON.stringify(result, undefined, 2));
	} catch {
		console.error("Monitor job operation failed: verify the ID, state and Valkey connection");
		process.exitCode = 1;
	} finally {
		await runtime.dispose();
	}
}
