/* oxlint-disable unicorn/no-null -- Node DNS callbacks require null for successful resolution. */
import dns from "node:dns";
import type { ClientRequest } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Data, Effect } from "effect";

export class WebhookDeliveryError extends Data.TaggedError("WebhookDeliveryError")<{
	readonly message: string;
}> {}

const reservedV4 = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	reservedV4.addSubnet(address, prefix, "ipv4");

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const reservedV6 = new BlockList();
// Exclude special-purpose, documentation and transition ranges. IPv4-mapped,
// local and multicast addresses are outside the global-unicast allowlist.
reservedV6.addSubnet("2001::", 23, "ipv6");
reservedV6.addSubnet("2001:db8::", 32, "ipv6");
reservedV6.addSubnet("2002::", 16, "ipv6");
reservedV6.addSubnet("3fff::", 20, "ipv6");

const isPublicAddress = (address: string): boolean => {
	const family = isIP(address);
	return family === 4
		? !reservedV4.check(address, "ipv4")
		: family === 6 && globalV6.check(address, "ipv6") && !reservedV6.check(address, "ipv6");
};

const hostname = (url: URL): string => url.hostname.replace(/^\[|\]$/g, "");

export const validateWebhookUrl = (value: string): void => {
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			value.includes("#") ||
			(isIP(hostname(url)) !== 0 && !isPublicAddress(hostname(url)))
		)
			throw new Error();
	} catch {
		throw new Error("Invalid webhook destination");
	}
};

export const sendWebhook = (
	url: string,
	bearerToken: string,
	payload: unknown
): Effect.Effect<void, WebhookDeliveryError> =>
	Effect.tryPromise({
		try: signal =>
			new Promise<void>((resolve, reject) => {
				let request: ClientRequest | undefined;
				let finished = false;
				const finish = (message?: string) => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					signal.removeEventListener("abort", abort);
					request?.destroy();
					if (message) reject(new WebhookDeliveryError({ message }));
					else resolve();
				};
				const abort = () => finish("Webhook delivery interrupted");
				const timer = setTimeout(() => finish("Webhook delivery timed out"), 10_000);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) {
					abort();
					return;
				}

				let target: URL;
				try {
					validateWebhookUrl(url);
					target = new URL(url);
				} catch {
					finish("Invalid webhook destination");
					return;
				}
				const send = (addresses: dns.LookupAddress[]) => {
					if (finished) return;
					const selected = addresses[0];
					if (!selected || !addresses.every(({ address }) => isPublicAddress(address))) {
						finish("Invalid webhook destination");
						return;
					}
					try {
						const body = JSON.stringify(payload);
						request = https.request(
							target,
							{
								method: "POST",
								agent: false,
								// Preserve the original hostname for TLS verification; never resolve it twice.
								lookup: (_host, options, callback) => {
									if (options.all) callback(null, [selected]);
									else callback(null, selected.address, selected.family);
								},
								headers: {
									Authorization: `Bearer ${bearerToken}`,
									"Content-Type": "application/json",
									"Content-Length": Buffer.byteLength(body),
								},
							},
							response => {
								const status = response.statusCode ?? 0;
								// Delivery is acknowledged by status; never retain or log receiver bodies.
								response.destroy();
								finish(status >= 200 && status < 300 ? undefined : `Webhook returned HTTP ${status}`);
							}
						);
						request.on("error", () => finish("Webhook delivery failed"));
						request.end(body);
					} catch {
						finish("Webhook delivery failed");
					}
				};
				const host = hostname(target);
				const family = isIP(host);
				if (family) send([{ address: host, family }]);
				else {
					try {
						dns.lookup(host, { all: true }, (error, addresses) => {
							if (error) finish("Webhook DNS resolution failed");
							else send(addresses);
						});
					} catch {
						finish("Webhook DNS resolution failed");
					}
				}
			}),
		catch: error =>
			error instanceof WebhookDeliveryError
				? error
				: new WebhookDeliveryError({ message: "Webhook delivery failed" }),
	});
