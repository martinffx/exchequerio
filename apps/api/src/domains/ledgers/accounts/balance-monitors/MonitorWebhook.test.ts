import { createHmac } from "node:crypto";
/* oxlint-disable unicorn/no-null -- Node DNS callbacks require null for successful resolution. */
import dns from "node:dns";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWebhook, validateWebhookUrl } from "./MonitorWebhook";

const signingSecret = "whsec_BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("webhook destination validation", () => {
	it.each([
		"http://example.com",
		"https://user:secret@example.com",
		"https://example.com/#fragment",
		"https://example.com/#",
		"https://127.0.0.1",
		"https://10.1.2.3",
		"https://172.31.0.1",
		"https://192.168.1.1",
		"https://169.254.169.254",
		"https://100.64.0.1",
		"https://0.0.0.0",
		"https://224.0.0.1",
		"https://192.0.2.1",
		"https://198.18.0.1",
		"https://240.0.0.1",
		"https://[::1]",
		"https://[fc00::1]",
		"https://[fe80::1]",
		"https://[::ffff:127.0.0.1]",
		"https://[2001:db8::1]",
		"https://[2002:7f00:1::]",
		"https://2130706433",
	])("rejects unsafe target %s", url => {
		expect(() => validateWebhookUrl(url)).toThrow("Invalid webhook destination");
	});
	it.each(["https://example.com/path?event=1", "https://8.8.8.8", "https://[2606:4700:4700::1111]"])(
		"accepts public HTTPS target %s",
		url => {
			expect(() => validateWebhookUrl(url)).not.toThrow();
		}
	);
});

function transport(
	status?: number,
	addresses: dns.LookupAddress[] = [{ address: "8.8.8.8", family: 4 }]
) {
	const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
	const response = Object.assign(new EventEmitter(), { statusCode: status, destroy: vi.fn() });
	const request = vi.spyOn(https, "request").mockImplementation((_url, _options, callback) => {
		if (status !== undefined)
			queueMicrotask(() => callback?.(response as unknown as IncomingMessage));
		return req as unknown as ClientRequest;
	});
	const lookup = vi.spyOn(dns, "lookup").mockImplementation(((
		_host: string,
		_options: dns.LookupAllOptions,
		callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void
	) => {
		callback(null, addresses);
	}) as typeof dns.lookup);
	return { req, response, request, lookup };
}

describe("webhook delivery", () => {
	it("pins a public address and signs the transmitted JSON and refreshes the timestamp on retry", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1700000000000);
		const { request, req } = transport(204);
		await Effect.runPromise(
			sendWebhook("https://example.com/hook", signingSecret, { eventId: "event" })
		);
		const options = request.mock.calls[0]?.[1] as https.RequestOptions;
		expect(options.headers).toMatchObject({
			"webhook-id": "event",
			"webhook-timestamp": "1700000000",
			"webhook-signature": `v1,${createHmac("sha256", Buffer.alloc(32, 7)).update('event.1700000000.{"eventId":"event"}').digest("base64")}`,
			"Content-Type": "application/json",
		});
		expect(options.agent).toBe(false);
		const callback = vi.fn();
		options.lookup?.("example.com", { all: true }, callback);
		expect(callback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
		expect(req.end).toHaveBeenCalledWith('{"eventId":"event"}');
		expect(options.headers).not.toHaveProperty("Authorization");
		vi.mocked(Date.now).mockReturnValue(1700000001000);
		await Effect.runPromise(
			sendWebhook("https://example.com/hook", signingSecret, { eventId: "event" })
		);
		const retried = request.mock.calls[1]?.[1] as https.RequestOptions;
		expect(retried.headers).toMatchObject({
			"webhook-id": "event",
			"webhook-timestamp": "1700000001",
		});
		expect(retried.headers).not.toEqual(options.headers);
	});
	it.each(["127.0.0.1", "::ffff:127.0.0.1", "fe80::1", "fd00::1"])(
		"rejects DNS results containing unsafe address %s",
		async address => {
			const { request } = transport(200, [
				{ address: "8.8.8.8", family: 4 },
				{ address, family: address.includes(":") ? 6 : 4 },
			]);
			await expect(
				Effect.runPromise(sendWebhook("https://example.com", signingSecret, { eventId: "event" }))
			).rejects.toThrow("Invalid webhook destination");
			expect(request).not.toHaveBeenCalled();
		}
	);
	it("treats redirects as failed deliveries without following them", async () => {
		const { request } = transport(302);
		await expect(
			Effect.runPromise(sendWebhook("https://example.com", signingSecret, { eventId: "event" }))
		).rejects.toThrow("Webhook returned HTTP 302");
		expect(request).toHaveBeenCalledOnce();
	});
	it("times out stalled DNS after ten seconds without sending a late request", async () => {
		vi.useFakeTimers();
		const { lookup, request } = transport();
		let completeLookup: (() => void) | undefined;
		lookup.mockImplementation(((
			_host: string,
			_options: dns.LookupAllOptions,
			callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void
		) => {
			completeLookup = () => callback(null, [{ address: "8.8.8.8", family: 4 }]);
		}) as typeof dns.lookup);
		const result = Effect.runPromise(
			sendWebhook("https://example.com", signingSecret, { eventId: "event" })
		);
		const assertion = expect(result).rejects.toThrow("Webhook delivery timed out");
		await vi.advanceTimersByTimeAsync(10_000);
		await assertion;
		completeLookup?.();
		expect(request).not.toHaveBeenCalled();
	});
	it("times out a connected receiver and destroys its request", async () => {
		vi.useFakeTimers();
		const { req } = transport();
		const result = Effect.runPromise(
			sendWebhook("https://example.com", signingSecret, { eventId: "event" })
		);
		const assertion = expect(result).rejects.toThrow("Webhook delivery timed out");
		await vi.advanceTimersByTimeAsync(10_000);
		await assertion;
		expect(req.destroy).toHaveBeenCalled();
	});
	it("aborts the request on interruption", async () => {
		const { req, request } = transport();
		const controller = new AbortController();
		const result = Effect.runPromise(
			sendWebhook("https://example.com", signingSecret, { eventId: "event" }),
			{
				signal: controller.signal,
			}
		);
		await vi.waitFor(() => expect(request).toHaveBeenCalled());
		controller.abort();
		await expect(result).rejects.toThrow();
		expect(req.destroy).toHaveBeenCalled();
	});
	it("redacts native error messages", async () => {
		const { req, request } = transport();
		const result = Effect.runPromise(
			sendWebhook("https://example.com", signingSecret, { eventId: "event" })
		);
		await vi.waitFor(() => expect(request).toHaveBeenCalled());
		req.emit("error", new Error("private-token https://example.com"));
		await expect(result).rejects.toThrow("Webhook delivery failed");
	});
});
