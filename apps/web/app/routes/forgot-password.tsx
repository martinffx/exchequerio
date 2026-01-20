import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { createPasswordReset } from "@/lib/auth.server";
import type { Route } from "./+types/forgot-password";

/**
 * Action: Handles password reset request
 */
export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData();
	const email = formData.get("email") as string;

	try {
		await createPasswordReset(email);
		return { success: true };
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "An error occurred",
		};
	}
}

/**
 * Forgot Password page component
 */
export default function ForgotPassword({ actionData }: Route.ComponentProps) {
	return <ForgotPasswordForm success={actionData?.success} error={actionData?.error} />;
}
