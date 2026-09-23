import type { RedisJobStore } from "effect-mq/redis";
import { makeJobStore } from "@/lib/queues";

type MonitorQueueOptions = Pick<
	RedisJobStore.RedisJobStoreOptions,
	"prefix" | "historyTtl" | "historySweepInterval"
>;

export const makeMonitorJobStore = (valkeyUrl: string, options: MonitorQueueOptions = {}) =>
	makeJobStore(valkeyUrl, {
		prefix: "exchequer-balance-monitors",
		historyTtl: { completed: "1 day", failed: "7 days", cancelled: "1 day" },
		historySweepInterval: "1 minute",
		...options,
	});
