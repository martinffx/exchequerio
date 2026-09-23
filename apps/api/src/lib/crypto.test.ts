import { describe, expect, it } from "vitest";
import { decodeSigningSecret, signWebhook, decryptSecret, encryptSecret } from "./crypto";

const key = Buffer.alloc(32, 7).toString("base64");
describe("secrets", () => {
	it("roundtrips tokens with randomized authenticated ciphertext", () => {
		const encrypted = encryptSecret("private-token", key);
		expect(encrypted).not.toContain("private-token");
		expect(encryptSecret("private-token", key)).not.toBe(encrypted);
		expect(decryptSecret(encrypted, key)).toBe("private-token");
	});
	it("rejects tampering and wrong keys without exposing inputs", () => {
		const encrypted = encryptSecret("private-token", key);
		for (const value of ["private-token", `${encrypted.slice(0, -4)}AAAA`]) {
			expect(() => decryptSecret(value, key)).toThrow("Unable to decrypt secret");
		}
		expect(() => decryptSecret(encrypted, Buffer.alloc(32, 8).toString("base64"))).toThrow(
			"Unable to decrypt secret"
		);
	});
	it.each(["secret", "", Buffer.alloc(31).toString("base64"), `${key}garbage`])(
		"rejects invalid keys",
		invalid => {
			expect(() => encryptSecret("private-token", invalid)).toThrow("Invalid encryption key");
			expect(() => decryptSecret("private-token", invalid)).toThrow("Invalid encryption key");
		}
	);
});

it("signs the exact body, event ID and attempt timestamp with a known HMAC vector", () => {
	const secret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
	const body = '{"amount":"100"}';
	const signature = signWebhook(secret, "event-1", 1700000000, body);
	expect(signature).toBe("v1,LPfRWwAYoIRbsNpSXhIG8xEQqOUWq4IATGd0KZs2QQ4=");
	for (const [id, timestamp, payload] of [
		["event-2", 1700000000, body],
		["event-1", 1700000001, body],
		["event-1", 1700000000, '{ "amount": "100" }'],
	] as const)
		expect(signWebhook(secret, id, timestamp, payload)).not.toBe(signature);
});
it.each([
	"",
	"secret",
	`whsec_${Buffer.alloc(31).toString("base64")}`,
	`whsec_${key}garbage`,
	`whsec_${key.slice(0, -1)}`,
])("rejects malformed signing secrets (%#)", value => {
	expect(() => decodeSigningSecret(value)).toThrow("Invalid webhook signing secret");
});
