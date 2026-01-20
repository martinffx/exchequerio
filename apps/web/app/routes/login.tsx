import { redirect } from "react-router";
import { LoginForm } from "@/components/auth/LoginForm";
import { authenticateWithPassword } from "@/lib/auth.server";
import { EmailVerificationRequiredError } from "@/lib/errors";
import { createSessionStorage, getUserSession } from "@/lib/session.server";
import type { Route } from "./+types/login";

/**
 * Loader: Redirects authenticated users to dashboard
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const session = await getUserSession(request, context.cloudflare.env.SESSION_KV);

	if (session) {
		throw redirect("/dashboard");
	}

	return null;
}

/**
 * Action: Handles login form submission
 */
export async function action({ request, context }: Route.ActionArgs) {
	const formData = await request.formData();
	const email = formData.get("email") as string;
	const password = formData.get("password") as string;

	try {
		const authResponse = await authenticateWithPassword(email, password);
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

		if (error instanceof EmailVerificationRequiredError) {
			throw redirect(`/verify-email?email=${encodeURIComponent(email)}`);
		}

		return {
			error: error instanceof Error ? error.message : "An error occurred",
		};
	}
}

/**
 * Login page component
 */
export default function Login({ actionData }: Route.ComponentProps) {
	return <LoginForm error={actionData?.error} />;
}
