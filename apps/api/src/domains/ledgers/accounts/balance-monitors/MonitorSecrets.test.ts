import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./MonitorSecrets";

const key = Buffer.alloc(32, 7).toString("base64");
describe("monitor secrets", () => {
	it("roundtrips tokens with randomized authenticated ciphertext", () => {
		const encrypted = encryptToken("private-token", key);
		expect(encrypted).not.toContain("private-token");
		expect(encryptToken("private-token", key)).not.toBe(encrypted);
		expect(decryptToken(encrypted, key)).toBe("private-token");
	});
	it("rejects tampering and wrong keys without exposing inputs", () => {
		const encrypted = encryptToken("private-token", key);
		for (const value of ["private-token", `${encrypted.slice(0, -4)}AAAA`]) {
			expect(() => decryptToken(value, key)).toThrow("Unable to decrypt monitor token");
		}
		expect(() => decryptToken(encrypted, Buffer.alloc(32, 8).toString("base64"))).toThrow(
			"Unable to decrypt monitor token"
		);
	});
	it.each(["secret", "", Buffer.alloc(31).toString("base64"), `${key}garbage`])(
		"rejects invalid keys",
		invalid => {
			expect(() => encryptToken("private-token", invalid)).toThrow("Invalid monitor encryption key");
			expect(() => decryptToken("private-token", invalid)).toThrow("Invalid monitor encryption key");
		}
	);
});
