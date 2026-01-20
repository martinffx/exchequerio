/**
 * Cloudflare Workers environment bindings and types
 */

export interface Env {
	SESSION_KV: KVNamespace;
	API_URL: string;
	WORKOS_CLIENT_ID: string;
	WORKOS_API_KEY: string;
	WORKOS_COOKIE_PASSWORD: string;
}

/**
 * Augment React Router types to include Cloudflare context
 */
declare module "react-router" {
	interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}
