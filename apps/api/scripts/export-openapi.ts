import { buildServer } from "../src/server";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const OUTPUT_PATH = join(__dirname, "../../docs/static/openapi.json");

async function exportSpec() {
	console.log("🔧 Building Fastify server...");
	const server = await buildServer();
	await server.ready();

	console.log("📋 Generating OpenAPI specification...");
	const spec = server.swagger();

	// Ensure directory exists
	await mkdir(dirname(OUTPUT_PATH), { recursive: true });
	await Bun.write(OUTPUT_PATH, JSON.stringify(spec, null, 2));

	await server.close();
	console.log(`✅ OpenAPI spec exported to ${OUTPUT_PATH}`);
}

exportSpec().catch((err) => {
	console.error("❌ Failed to export OpenAPI spec:", err);
	process.exit(1);
});
