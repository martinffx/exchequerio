import { afterEach } from "vitest";
import { signJWT } from "@/auth";
import { makeTestWebHandler, type TestStubs } from "@/server";

/** Builds scoped bearer tokens for one organization. */
const tokenFor =
	(organizationId: { toString(): string }) => (scope: Parameters<typeof signJWT>[0]["scope"]) =>
		signJWT({ sub: organizationId.toString(), scope });

/** Builds web `Request`s, authenticated with `defaultToken()` unless a token or `anonymous` is given. */
const makeRequest =
	(defaultToken: () => string) =>
	(
		method: string,
		path: string,
		options: {
			token?: string;
			anonymous?: boolean;
			body?: unknown;
			headers?: Record<string, string>;
		} = {}
	) => {
		const token = options.anonymous === true ? undefined : (options.token ?? defaultToken());
		return new Request(`http://localhost${path}`, {
			method,
			headers: {
				...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
				...(options.body === undefined ? {} : { "content-type": "application/json" }),
				...options.headers,
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	};

/** Returns a web handler factory for stubbed services; call at module scope, handlers are disposed after each test. */
const useTestWebHandlers = () => {
	const disposers: Array<() => Promise<void>> = [];
	afterEach(async () => {
		for (const dispose of disposers.splice(0)) await dispose();
	});
	return (stubs: TestStubs) => {
		const { handler, dispose } = makeTestWebHandler(stubs);
		disposers.push(dispose);
		return handler;
	};
};

export { makeRequest, tokenFor, useTestWebHandlers };
