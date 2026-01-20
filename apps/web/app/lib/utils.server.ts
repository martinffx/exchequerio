/**
 * Checks if a JWT token is expired or will expire within 1 minute.
 * This function does NOT verify the token signature - it only checks expiration.
 *
 * @param token - JWT token string
 * @returns true if token is expired, expiring soon (< 1 min), or malformed
 *
 * @example
 * ```ts
 * const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 * if (isTokenExpired(token)) {
 *   // Refresh the token
 * }
 * ```
 */
export function isTokenExpired(token: string): boolean {
	try {
		// JWT structure: header.payload.signature
		const parts = token.split(".");
		if (parts.length !== 3) {
			return true; // Invalid JWT structure
		}

		// Decode the payload (second part)
		const payload = JSON.parse(atob(parts[1])) as { exp?: unknown };

		// Check if exp claim exists
		if (!payload.exp || typeof payload.exp !== "number") {
			return true; // No expiration claim
		}

		// Convert exp from seconds to milliseconds
		const expirationTime = payload.exp * 1000;
		const now = Date.now();

		// Consider token expired if it expires within 1 minute (60,000 ms)
		const bufferTime = 60 * 1000;
		return expirationTime - now < bufferTime;
	} catch {
		// If any error occurs during decoding, consider token expired
		return true;
	}
}
