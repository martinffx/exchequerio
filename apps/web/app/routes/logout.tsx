import { redirect } from "react-router";
import { logoutUser } from "../lib/auth.server";
import { destroySession, getSession } from "../lib/session.server";
import type { Route } from "./+types/logout";

/**
 * Logout Route
 *
 * Handles user logout by:
 * 1. Calling WorkOS logout endpoint to revoke session
 * 2. Destroying local session cookie
 * 3. Redirecting to login page
 */

export async function loader() {
	// Redirect GET requests to /login
	// Logout should only be performed via POST for security
	return redirect("/login");
}

export async function action({ request }: Route.ActionArgs) {
	// Get current session
	const session = await getSession(request);

	// Call WorkOS logout endpoint if session exists
	// Note: logoutUser handles errors internally, but we wrap in try-catch for safety
	if (session) {
		try {
			await logoutUser(session.user.id);
		} catch (error) {
			// Ignore logout errors - we still want to clear the session
			console.error("Logout error:", error);
		}
	}

	// Destroy session cookie
	const cookie = await destroySession();

	// Redirect to login with cleared session cookie
	return redirect("/login", {
		headers: {
			"Set-Cookie": cookie,
		},
	});
}

export default function Logout() {
	// This route should never render as it always redirects
	return null;
}
