import { createWorkersKVSessionStorage } from "@react-router/cloudflare";
import type { SessionData } from "./types";

/**
 * Creates session storage using Cloudflare Workers KV
 *
 * Session data is stored in KV with an encrypted session ID in the cookie.
 * This enables session revocation and removes size limits of cookie-only storage.
 *
 * @param kv - Cloudflare KV namespace binding
 * @returns Session storage instance with getSession, commitSession, destroySession methods
 */
export function createSessionStorage(kv: KVNamespace) {
	return createWorkersKVSessionStorage<SessionData>({
		kv,
		cookie: {
			name: "workos_session",
			httpOnly: true, // Not accessible via JavaScript (XSS protection)
			secure: true, // HTTPS only (always true on CF Workers)
			sameSite: "lax", // CSRF protection
			secrets: [process.env.WORKOS_COOKIE_PASSWORD!], // 32+ characters
			maxAge: 60 * 60 * 24 * 7, // 7 days
		},
	});
}

/**
 * Helper function to get session data from request
 *
 * Extracts the session cookie from the request and retrieves
 * the session data from Cloudflare KV.
 *
 * @param request - Incoming HTTP request
 * @param kv - Cloudflare KV namespace binding
 * @returns Session data if exists, null otherwise
 *
 * @example
 * ```typescript
 * export async function loader({ request, context }: Route.LoaderArgs) {
 *   const session = await getUserSession(request, context.cloudflare.env.SESSION_KV)
 *   if (!session) {
 *     throw redirect("/login")
 *   }
 *   return { user: session.user }
 * }
 * ```
 */
export async function getUserSession(
	request: Request,
	kv: KVNamespace
): Promise<SessionData | null> {
	const { getSession } = createSessionStorage(kv);
	const session = await getSession(request.headers.get("Cookie"));

	if (!session.has("accessToken")) {
		return null;
	}

	return {
		accessToken: session.get("accessToken"),
		refreshToken: session.get("refreshToken"),
		user: session.get("user"),
	};
}
