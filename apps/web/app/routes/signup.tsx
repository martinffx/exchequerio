import { redirect } from "react-router";
import { createUser } from "@/lib/auth.server";
import { SignupForm } from "@/components/auth/SignupForm";
import type { Route } from "./+types/signup";

/**
 * Action: Handles signup form submission
 */
export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData();
	const email = formData.get("email") as string;
	const password = formData.get("password") as string;

	try {
		await createUser(email, password);
		throw redirect(`/verify-email?email=${encodeURIComponent(email)}`);
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
 * Signup page component
 */
export default function Signup({ actionData }: Route.ComponentProps) {
	return <SignupForm error={actionData?.error} />;
}
