import { redirect } from "react-router";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { resetPassword } from "@/lib/auth.server";
import type { Route } from "./+types/reset-password";

/**
 * Loader: Extracts reset token from query params
 */
export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url);
	const token = url.searchParams.get("token");

	return { token };
}

/**
 * Action: Handles password reset submission
 */
export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData();
	const token = formData.get("token") as string;
	const password = formData.get("password") as string;

	try {
		await resetPassword(token, password);
		return redirect("/login?reset=success");
	} catch (error) {
		// Check if error is a Response (redirect) and re-throw it
		if (error instanceof Response) {
			throw error;
		}

		return {
			error: error instanceof Error ? error.message : "An error occurred",
		};
	}
}

/**
 * Reset Password page component
 */
export default function ResetPassword({ loaderData, actionData }: Route.ComponentProps) {
	return <ResetPasswordForm token={loaderData.token} error={actionData?.error} />;
}
