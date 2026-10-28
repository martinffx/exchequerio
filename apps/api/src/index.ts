import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Cause, Exit, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { Config } from "@/config";
import { makeServerLayer } from "@/server";

// HttpMiddleware.logger is already a global middleware of the app, so the router's own logger is off.
const main = HttpRouter.serve(makeServerLayer(new Config()), { disableLogger: true }).pipe(
	// NodeHttpServer drains in-flight requests for at most its default 20 s gracefulShutdownTimeout (Fastify had no cap).
	Layer.provide(NodeHttpServer.layer(createServer, { port: 3000, host: "::" }))
);

// A signal interrupts the main fiber; that is a clean shutdown (exit 0), any other failure exits 1.
NodeRuntime.runMain(Layer.launch(main), {
	teardown: (exit, onExit) =>
		onExit(Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? 0 : 1),
});
