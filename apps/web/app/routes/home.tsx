import type { Route } from "./+types/home";

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Exchequer" },
		{ name: "description", content: "Modern double-entry ledger API" },
	];
}

export default function Home() {
	return (
		<div className="min-h-screen flex items-center justify-center bg-gray-50">
			<div className="text-center">
				<h1 className="text-4xl font-bold text-gray-900 mb-4">Exchequer</h1>
				<p className="text-lg text-gray-600">Modern double-entry ledger API</p>
			</div>
		</div>
	);
}
