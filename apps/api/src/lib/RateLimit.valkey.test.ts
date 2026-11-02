import { type AddressInfo, createServer, type Socket } from "node:net";
import { Effect, ManagedRuntime } from "effect";
import { RateLimiter } from "effect/unstable/persistence";
import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import { Config } from "@/config";
import { newOrgID } from "@/lib/ids";
import { makeRateLimiterLayer, makeServerRuntimeLayer } from "@/runtime";

/** Consumes one token for an Organization through whichever RateLimiter is provided. */
// Explicit values: .env.test's RATE_LIMIT_MAX=1000000 makes the keys expire in about 1 ms.
const consumeOnce = (organizationId: string) =>
	Effect.gen(function* () {
		const limiter = yield* RateLimiter.RateLimiter;
		return yield* limiter.consume({
			key: organizationId,
			limit: 2,
			window: "60 seconds",
			algorithm: "token-bucket",
			onExceeded: "fail",
		});
	});

/** Splits pipelined RESP array commands into their arguments; enough for ioredis's handshake. */
const respCommands = (text: string): ReadonlyArray<ReadonlyArray<string>> =>
	[...text.matchAll(/\*\d+\r\n((?:\$\d+\r\n[^\r]*\r\n)+)/g)].map(command =>
		[...(command[1] ?? "").matchAll(/\$\d+\r\n([^\r]*)\r\n/g)].map(argument => argument[1] ?? "")
	);

describe("rate limiter against Valkey", () => {
	it("stores the token bucket and its refill key with a TTL in the server runtime", async () => {
		const config = new Config();
		const organizationId = newOrgID().toString();
		const keys = [
			`exchequer:ratelimit:${organizationId}`,
			`exchequer:ratelimit:${organizationId}:refill`,
		];
		const runtime = ManagedRuntime.make(makeServerRuntimeLayer(config));
		const client = new Redis(config.valkeyUrl);
		try {
			await runtime.runPromise(consumeOnce(organizationId));
			for (const key of keys) {
				expect(await client.exists(key), key).toBe(1);
				expect(await client.pttl(key), key).toBeGreaterThan(0);
			}
		} finally {
			await client.del(...keys);
			client.disconnect();
			await runtime.dispose();
		}
	});

	// Fail-open itself is the middleware's job (covered in RateLimit.test.ts). The speed here comes
	// from enableOfflineQueue: false, not commandTimeout. The full runtime cannot be built against a
	// closed port (the balance-monitor job store calls Valkey while building).
	it("fails fast with a store error when Valkey is unreachable", async () => {
		const runtime = ManagedRuntime.make(makeRateLimiterLayer("redis://127.0.0.1:1"));
		try {
			await runtime.runPromise(Effect.void);
			const started = performance.now();
			const error = await runtime.runPromise(Effect.flip(consumeOnce(newOrgID().toString())));
			const elapsed = performance.now() - started;
			expect(error.reason._tag).toBe("RateLimitStoreError");
			expect(elapsed).toBeLessThan(250 + 250);
		} finally {
			await runtime.dispose();
		}
	}, 15_000);

	// A peer that vanishes without a reset leaves the socket "ready", so timed-out commands would
	// stay queued until the kernel gives up. socketTimeout must destroy it, and each request must
	// still be bounded by commandTimeout in the meantime.
	it("bounds each request and recycles the socket when Valkey stops answering", async () => {
		let answeredHandshake!: () => void;
		let socketClosed!: () => void;
		const handshakeAnswered = new Promise<void>(resolve => (answeredHandshake = resolve));
		const closed = new Promise<void>(resolve => (socketClosed = resolve));
		const sockets = new Set<Socket>();
		// Answers ioredis's handshake (HELLO, CLIENT SETINFO, the INFO ready check), then goes silent
		// like a black-holed peer. Going silent earlier would stop the client ever becoming ready.
		const server = createServer(socket => {
			sockets.add(socket);
			let silent = false;
			socket.on("data", chunk => {
				for (const [name] of respCommands(String(chunk))) {
					if (silent) continue;
					const command = name?.toLowerCase();
					if (command === "hello") socket.write("-ERR unknown command 'hello'\r\n");
					else if (command === "info") {
						const info = "loading:0\r\n";
						socket.write(`$${info.length}\r\n${info}\r\n`);
						silent = true;
						answeredHandshake();
					} else socket.write("+OK\r\n");
				}
			});
			socket.on("close", () => socketClosed());
			socket.on("error", () => undefined);
		});
		await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const runtime = ManagedRuntime.make(makeRateLimiterLayer(`redis://127.0.0.1:${port}`));
		try {
			await runtime.runPromise(Effect.void);
			await handshakeAnswered;
			await new Promise(resolve => setTimeout(resolve, 100));

			const started = performance.now();
			const error = await runtime.runPromise(Effect.flip(consumeOnce(newOrgID().toString())));
			expect(error.reason._tag).toBe("RateLimitStoreError");
			expect(performance.now() - started).toBeLessThan(1000 + 500);

			await Promise.race([
				closed,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("socket was not recycled")), 2000 + 1500)
				),
			]);
		} finally {
			await runtime.dispose();
			for (const socket of sockets) socket.destroy();
			await new Promise(resolve => server.close(resolve));
		}
	}, 15_000);
});
