import { redirect } from "react-router";

import { MagicLinkForm } from "@/components/auth/MagicLinkForm";
import { authenticateWithMagicAuth, sendMagicAuthCode } from "@/lib/auth.server";
import { createSessionStorage } from "@/lib/session.server";

import type { Route } from "./+types/magic-link";

/**
 * Action: Handles magic link authentication flow
 * Step 1: Send magic link code (no code provided)
 * Step 2: Authenticate with code (code provided)
 */
export async function action({ request, context }: Route.ActionArgs) {
	const formData = await request.formData();
	const email = formData.get("email") as string;
	const code = formData.get("code") as string;

	// Step 1: Send magic link code
	if (!code) {
		try {
			await sendMagicAuthCode(email);
			return { codeSent: true };
		} catch (error) {
			// Re-throw Response objects (redirects)
			if (error instanceof Response) {
				throw error;
			}

			return {
				error: error instanceof Error ? error.message : "Failed to send code",
			};
		}
	}

	// Step 2: Authenticate with code
	try {
		const authResponse = await authenticateWithMagicAuth(code, email);
		const { getSession, commitSession } = createSessionStorage(context.cloudflare.env.SESSION_KV);
		const session = await getSession(request.headers.get("Cookie"));

		session.set("accessToken", authResponse.accessToken);
		session.set("refreshToken", authResponse.refreshToken);
		session.set("user", authResponse.user);

		throw redirect("/dashboard", {
			headers: { "Set-Cookie": await commitSession(session) },
		});
	} catch (error) {
		// Re-throw Response objects (redirects)
		if (error instanceof Response) {
			throw error;
		}

		return {
			error: error instanceof Error ? error.message : "Authentication failed",
		};
	}
}

/**
 * Component: Magic link authentication page
 */
export default function MagicLink({ actionData }: Route.ComponentProps) {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<MagicLinkForm codeSent={actionData?.codeSent} error={actionData?.error} />
		</div>
	);
}
