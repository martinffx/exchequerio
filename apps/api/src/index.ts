import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Cause, Exit, Layer } from "effect";
import { Config } from "@/config";
import { makeServerRuntimeLayer } from "@/runtime";
import { createHttpServer, serveApp } from "@/server";

const main = serveApp(
	// NodeHttpServer's default 20 s gracefulShutdownTimeout bounds reads: reads still in flight at the
	// cap are interrupted. Writes run to completion (`runToCompletion`) and shutdown waits for them,
	// bounded only by the orchestrator's kill timeout.
	NodeHttpServer.layer(createHttpServer, { port: 3000, host: "::" }),
	makeServerRuntimeLayer(new Config())
);

// A signal interrupts the main fiber; that is a clean shutdown (exit 0), any other failure exits 1.
NodeRuntime.runMain(Layer.launch(main), {
	teardown: (exit, onExit) =>
		onExit(Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? 0 : 1),
});
