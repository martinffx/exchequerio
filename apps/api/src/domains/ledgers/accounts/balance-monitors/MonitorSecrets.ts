import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const decodeKey = (key: string): Buffer => {
	const bytes = Buffer.from(key, "base64");
	if (bytes.length !== 32 || bytes.toString("base64") !== key) {
		throw new Error("Invalid monitor encryption key");
	}
	return bytes;
};

export const encryptToken = (token: string, key: string): string => {
	const secret = decodeKey(key);
	try {
		const nonce = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", secret, nonce);
		const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
		return `v1.${Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
	} catch {
		throw new Error("Unable to encrypt monitor token");
	}
};

export const decryptToken = (ciphertext: string, key: string): string => {
	const secret = decodeKey(key);
	try {
		if (!ciphertext.startsWith("v1.")) throw new Error();
		const encoded = ciphertext.slice(3);
		const bytes = Buffer.from(encoded, "base64");
		if (bytes.length < 28 || bytes.toString("base64") !== encoded) throw new Error();
		const decipher = createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
		decipher.setAuthTag(bytes.subarray(12, 28));
		return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
	} catch {
		throw new Error("Unable to decrypt monitor token");
	}
};
