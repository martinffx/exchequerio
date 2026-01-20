import { redirect } from "react-router";
import { getUserSession } from "@/lib/session.server";
import type { Route } from "./+types/home";

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Exchequer" },
		{ name: "description", content: "Modern double-entry ledger API" },
	];
}

/**
 * Loader: Protected route - requires authentication
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const session = await getUserSession(request, context.cloudflare.env.SESSION_KV);

	if (!session) {
		throw redirect("/login");
	}

	return { user: session.user };
}

export default function Home({ loaderData }: Route.ComponentProps) {
	return (
		<div className="min-h-screen flex items-center justify-center bg-gray-50">
			<div className="text-center">
				<h1 className="text-4xl font-bold text-gray-900 mb-4">
					Welcome, {loaderData?.user?.email || "Guest"}
				</h1>
				<p className="text-lg text-gray-600">Modern double-entry ledger API</p>
			</div>
		</div>
	);
}
