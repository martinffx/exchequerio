import type { CryptoKey, JWK } from "jose";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

// Keypair cached per test run (regenerated on each `bun test`)
let testKeyPair: { privateKey: CryptoKey; publicKey: CryptoKey; jwk: JWK } | undefined;

async function getTestKeyPair() {
	if (!testKeyPair) {
		const { privateKey, publicKey } = await generateKeyPair("RS256");
		const jwk = await exportJWK(publicKey);
		jwk.alg = "RS256";
		jwk.use = "sig";
		jwk.kid = "test-key-1";
		testKeyPair = { privateKey, publicKey, jwk };
	}
	return testKeyPair;
}

async function getTestJWKS(): Promise<{ keys: JWK[] }> {
	const { jwk } = await getTestKeyPair();
	return { keys: [jwk] };
}

interface SignTestJWTOptions {
	sub?: string; // User ID (defaults to test user if omitted)
	sid?: string; // Session ID (defaults to random if omitted)
	org_id?: string; // Organization ID (omitted if not provided)
	role?: string; // WorkOS role (admin/member/viewer)
	permissions?: string[]; // Explicit permissions (overrides role)
	expiresIn?: string; // Default: "1h"
}

async function signTestJWT(options: Partial<SignTestJWTOptions> = {}): Promise<string> {
	const { privateKey } = await getTestKeyPair();

	// Build payload dynamically - only include provided claims
	const payload: Record<string, unknown> = {};

	// sid: defaults to random if not provided
	if ("sid" in options) {
		payload.sid = options.sid;
	} else {
		payload.sid = `session_${Date.now()}`;
	}

	// org_id: only included if explicitly provided
	if ("org_id" in options) {
		payload.org_id = options.org_id;
	}

	// role and permissions: only included if provided
	if ("role" in options) {
		payload.role = options.role;
	}
	if ("permissions" in options) {
		payload.permissions = options.permissions;
	}

	const jwt = new SignJWT(payload)
		.setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
		.setIssuedAt()
		.setIssuer("https://api.workos.com")
		.setAudience("client_test_123") // Match WORKOS_CLIENT_ID in .env.test
		.setExpirationTime(options.expiresIn ?? "1h");

	// sub: defaults to random if not provided, only set if included
	if ("sub" in options) {
		if (options.sub !== undefined) {
			jwt.setSubject(options.sub);
		}
		// if sub is explicitly undefined, omit it
	} else {
		jwt.setSubject(`user_test_${Date.now()}`);
	}

	return await jwt.sign(privateKey);
}

export { getTestJWKS, signTestJWT, getTestKeyPair };
