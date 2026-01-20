import { redirect } from "react-router";

import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";
import { verifyEmailCode } from "@/lib/auth.server";
import { createSessionStorage } from "@/lib/session.server";

import type { Route } from "./+types/verify-email";

/**
 * Loader: Extracts email from query params for display
 */
export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url);
	const email = url.searchParams.get("email");

	return { email };
}

/**
 * Action: Handles verification code submission
 */
export async function action({ request, context }: Route.ActionArgs) {
	const formData = await request.formData();
	const email = formData.get("email") as string;
	const code = formData.get("code") as string;

	try {
		const authResponse = await verifyEmailCode(email, code);
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
			error: error instanceof Error ? error.message : "An error occurred",
		};
	}
}

/**
 * Verify Email page component
 */
export default function VerifyEmail({ loaderData, actionData }: Route.ComponentProps) {
	return <VerifyEmailForm email={loaderData?.email ?? undefined} error={actionData?.error} />;
}
