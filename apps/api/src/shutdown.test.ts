import { JobStore, MemoryJobStore } from "effect-mq";
import { MonitorPublisher, monitorPublisherLayer, type MonitorJob } from "@/jobs/MonitorPublisher";
import { MonitorDelivery } from "@/jobs/MonitorDelivery";
import { monitorJob } from "@/jobs/fixtures";
import { EventEmitter } from "node:events";
import { request } from "node:http";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Config } from "@/config";
import { ServerConfigTag, type ServerRuntimeLayer } from "@/runtime";
import { buildServer } from "@/server";
import { registerShutdown } from "@/shutdown";

describe("API shutdown", () => {
	it.each(["SIGTERM", "SIGINT"])(
		"drains an active request on %s before releasing runtime resources",
		async signal => {
			const disposed = vi.fn<() => void>();
			const runtimeLayer = Layer.effect(
				ServerConfigTag,
				Effect.gen(function* () {
					yield* Effect.addFinalizer(() => Effect.sync(disposed));
					return new Config({ environment: "test", jwtSecret: "test-secret" });
				})
			) as ServerRuntimeLayer;
			const server = await buildServer({ runtimeLayer });
			const signals = new EventEmitter();
			const stop = registerShutdown(server, signals);
			let beginRequest!: () => void;
			const started = new Promise<void>(resolve => {
				beginRequest = resolve;
			});
			let finishEnqueue!: () => void;
			const enqueue = new Promise<void>(resolve => {
				finishEnqueue = resolve;
			});
			server.get("/drain-test", async () => {
				beginRequest();
				await enqueue;
				return { committed: true };
			});
			const address = await server.listen({ port: 0, host: "127.0.0.1" });
			const response = new Promise<string>((resolve, reject) => {
				const req = request(`${address}/drain-test`, res => {
					let body = "";
					res.on("data", chunk => {
						body += chunk;
					});
					res.on("end", () => resolve(body));
				});
				req.on("error", reject);
				req.end();
			});
			// Attach rejection handling before signalling shutdown.
			const received = response.catch((error: unknown) => error);
			try {
				await started;
				signals.emit(signal);
				const closing = stop();
				expect(stop()).toBe(closing);
				await new Promise(resolve => setTimeout(resolve, 25));
				expect(disposed).not.toHaveBeenCalled();
				finishEnqueue();
				expect(await received).toBe('{"committed":true}');
				await closing;
				expect(disposed).toHaveBeenCalledOnce();
				expect(signals.listenerCount("SIGTERM")).toBe(0);
				expect(signals.listenerCount("SIGINT")).toBe(0);
			} finally {
				finishEnqueue();
				await server.close();
			}
		}
	);
});

it("responds before enqueue finishes, then drains publication on shutdown before closing Valkey", async () => {
	let finish!: () => void;
	const pending = new Promise<void>(resolve => {
		finish = resolve;
	});
	const enqueued = vi.fn<() => void>();
	const released = vi.fn<() => void>();
	const enqueue = vi.spyOn(MonitorDelivery, "enqueueMany").mockReturnValue(
		Effect.gen(function* () {
			yield* Effect.promise(() => pending);
			enqueued();
			return [];
		})
	);
	const store = Layer.effect(
		JobStore.JobStore,
		Effect.gen(function* () {
			const store = yield* JobStore.JobStore;
			yield* Effect.addFinalizer(() => Effect.sync(released));
			return store;
		})
	).pipe(Layer.provide(MemoryJobStore.layer));
	let publish!: (jobs: readonly MonitorJob[]) => Effect.Effect<void>;
	const runtimeLayer = Layer.effect(
		ServerConfigTag,
		Effect.gen(function* () {
			publish = yield* MonitorPublisher;
			return new Config({ environment: "test", jwtSecret: "test-secret" });
		})
	).pipe(Layer.provide(monitorPublisherLayer.pipe(Layer.provide(store)))) as ServerRuntimeLayer;
	const server = await buildServer({ runtimeLayer });
	const signals = new EventEmitter();
	const stop = registerShutdown(server, signals);
	server.get("/background-test", async () => {
		await server.runtime.runPromise(publish([monitorJob]));
		return { committed: true };
	});
	try {
		const response = await server.inject({ method: "GET", url: "/background-test" });
		expect(response.statusCode).toBe(200);
		expect(enqueued).not.toHaveBeenCalled();
		signals.emit("SIGTERM");
		const closing = stop();
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(released).not.toHaveBeenCalled();
		signals.emit("SIGINT");
		finish();
		await closing;
		expect(enqueued).toHaveBeenCalledOnce();
		expect(released).toHaveBeenCalledOnce();
	} finally {
		finish();
		await server.close();
		enqueue.mockRestore();
	}
});
