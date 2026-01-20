import { redirect } from "react-router";
import { refreshAccessToken } from "../lib/auth.server";
import { createSessionStorage, getUserSession } from "../lib/session.server";
import type { SessionData } from "../lib/types";
import { isTokenExpired } from "../lib/utils.server";
import type { Route } from "./+types/api.$";

/**
 * Handles GET requests to the API proxy.
 * Extracts session, refreshes token if needed, and forwards request to backend.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
	return handleApiProxy(request, params, context);
}

/**
 * Handles POST/PUT/DELETE requests to the API proxy.
 * Extracts session, refreshes token if needed, and forwards request to backend.
 */
export async function action({ request, params, context }: Route.ActionArgs) {
	return handleApiProxy(request, params, context);
}

/**
 * Refreshes the access token and updates the session.
 * Returns the new access token and the updated session cookie.
 */
async function refreshTokenAndUpdateSession(
	request: Request,
	session: SessionData,
	kv: KVNamespace
): Promise<{ accessToken: string; updatedCookie: string }> {
	const refreshed = await refreshAccessToken(session.refreshToken);

	// Update session with new tokens
	const { getSession, commitSession } = createSessionStorage(kv);
	const sessionObj = await getSession(request.headers.get("Cookie"));
	sessionObj.set("accessToken", refreshed.accessToken);
	sessionObj.set("refreshToken", refreshed.refreshToken);
	sessionObj.set("user", refreshed.user);

	const updatedCookie = await commitSession(sessionObj);

	return {
		accessToken: refreshed.accessToken,
		updatedCookie,
	};
}

/**
 * Builds the target URL for the backend API request.
 * Preserves the path and query parameters from the original request.
 */
function buildTargetUrl(request: Request, path: string, apiUrl: string): string {
	const url = new URL(path, apiUrl);

	// Copy query params from original request
	const searchParams = new URL(request.url).searchParams;
	searchParams.forEach((value, key) => {
		url.searchParams.append(key, value);
	});

	return url.toString();
}

/**
 * Prepares headers for the backend API request.
 * Copies headers from the original request and adds Authorization and host headers.
 */
function prepareHeaders(
	request: Request,
	accessToken: string,
	apiUrl: string
): Record<string, string> {
	const headers: Record<string, string> = {};

	// Copy relevant headers from original request
	request.headers.forEach((value, key) => {
		headers[key] = value;
	});

	// Set authorization and host headers
	headers.Authorization = `Bearer ${accessToken}`;
	headers.host = new URL(apiUrl).host;

	return headers;
}

/**
 * Handles API proxy logic for all HTTP methods.
 *
 * Flow:
 * 1. Extract session from cookie
 * 2. Check token expiration and refresh if needed
 * 3. Forward request to backend with Authorization header
 * 4. Return backend response to client
 * 5. Redirect to /login on 401
 *
 * @param request - Incoming HTTP request
 * @param params - Route parameters (contains wildcard path)
 * @param context - Cloudflare context with env bindings
 * @returns Backend response or redirect
 */
async function handleApiProxy(request: Request, params: any, context: any): Promise<Response> {
	const kv = context.cloudflare.env.SESSION_KV;
	const apiUrl = context.cloudflare.env.API_URL;

	// 1. Get session from cookie
	const session = await getUserSession(request, kv);
	if (!session) {
		throw redirect("/login");
	}

	// 2. Check token expiration and refresh if needed
	let accessToken = session.accessToken;
	let updatedCookie: string | null = null;

	if (isTokenExpired(accessToken)) {
		const refreshResult = await refreshTokenAndUpdateSession(request, session, kv);
		accessToken = refreshResult.accessToken;
		updatedCookie = refreshResult.updatedCookie;
	}

	// 3. Build target URL
	const path = params["*"]; // Everything after /api/
	const targetUrl = buildTargetUrl(request, path, apiUrl);

	// 4. Prepare headers
	const headers = prepareHeaders(request, accessToken, apiUrl);

	// 5. Get request body for non-GET/HEAD requests
	let body: string | undefined;
	if (request.method !== "GET" && request.method !== "HEAD") {
		body = await request.text();
	}

	// 6. Forward request to backend
	const backendResponse = await fetch(targetUrl, {
		method: request.method,
		headers,
		body,
	});

	// 7. Handle 401 - redirect to login
	if (backendResponse.status === 401) {
		throw redirect("/login");
	}

	// 8. Return backend response
	const responseHeaders = new Headers(backendResponse.headers);

	// Add updated session cookie if token was refreshed
	if (updatedCookie) {
		responseHeaders.set("Set-Cookie", updatedCookie);
	}

	return new Response(backendResponse.body, {
		status: backendResponse.status,
		statusText: backendResponse.statusText,
		headers: responseHeaders,
	});
}
