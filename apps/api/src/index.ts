import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Cause, Exit, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { Config } from "@/config";
import { makeServerLayer } from "@/server";

// The server keeps the pre-migration timeouts: 72 s keep-alive (the load balancer idle timeout must
// stay below it) and no request timeout.
const createHttpServer = () => createServer({ keepAliveTimeout: 72_000, requestTimeout: 0 });

// HttpMiddleware.logger is already a global middleware of the app, so the router's own logger is off.
const main = HttpRouter.serve(makeServerLayer(new Config()), { disableLogger: true }).pipe(
	// In-flight requests drain for at most NodeHttpServer's default 20 s gracefulShutdownTimeout
	// (the pre-migration server had no cap).
	Layer.provide(NodeHttpServer.layer(createHttpServer, { port: 3000, host: "::" }))
);

// A signal interrupts the main fiber; that is a clean shutdown (exit 0), any other failure exits 1.
NodeRuntime.runMain(Layer.launch(main), {
	teardown: (exit, onExit) =>
		onExit(Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? 0 : 1),
});
