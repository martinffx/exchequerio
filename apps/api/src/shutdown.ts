import type { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";

/** Drain active requests before onClose releases the application runtime. */
export const registerShutdown = (
	server: FastifyInstance,
	signals: Pick<EventEmitter, "on" | "removeListener"> = process
) => {
	let closing: Promise<void> | undefined;
	const stop = () => {
		closing ??= server
			.close()
			.then(
				() => {
					server.log.info("API shutdown complete");
				},
				() => {
					server.log.error("API shutdown failed");
					process.exitCode = 1;
				}
			)
			.finally(() => {
				signals.removeListener("SIGTERM", onSignal);
				signals.removeListener("SIGINT", onSignal);
			});
		return closing;
	};
	const onSignal = () => {
		void stop();
	};
	server.addHook("onSend", async (_request, reply, payload) => {
		if (closing) reply.header("connection", "close");
		return payload;
	});
	signals.on("SIGTERM", onSignal);
	signals.on("SIGINT", onSignal);
	return stop;
};
