import { Effect } from "effect";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { newOrgID } from "@/repo/entities/types";

import {
	type IdempotencyService,
	IdempotencyServiceTag,
	makeIdempotencyService,
} from "./IdempotencyService";

const fixture = () => ({
	organizationId: newOrgID(),
	key: crypto.randomUUID(),
});

describe("IdempotencyService", () => {
	const client = new Redis(new Config().valkeyUrl);
	const layer = makeIdempotencyService(client);

	beforeAll(() => client.ping());
	afterAll(() => client.disconnect());

	const run = <A, E>(use: (service: IdempotencyService) => Effect.Effect<A, E>) =>
		Effect.runPromise(IdempotencyServiceTag.use(use).pipe(Effect.provide(layer)));

	it("stores only the result ID and replays through the caller", async () => {
		const value = fixture();
		let executions = 0;
		const operation = {
			...value,
			action: "settlements.create",
			execute: Effect.sync(() => {
				executions += 1;
				return { id: "las_result" };
			}),
			resultId: (result: { id: string }) => result.id,
			replay: (id: string) => Effect.succeed({ id }),
		};

		expect(await run(service => service.run(operation))).toEqual({ id: "las_result" });
		expect(await run(service => service.run(operation))).toEqual({ id: "las_result" });
		expect(executions).toBe(1);
		expect(
			await client.get(
				`exchequer:idempotency:${value.organizationId.toString()}:${operation.action}:${value.key}`
			)
		).toBe("las_result");
	});

	it("scopes the same client key independently by action", async () => {
		const value = fixture();
		const actions: string[] = [];
		for (const action of ["settlements.transition", "transactions.create"]) {
			await run(service =>
				service.run({
					...value,
					action,
					execute: Effect.sync(() => {
						actions.push(action);
						return action;
					}),
					resultId: result => result,
					replay: Effect.succeed,
				})
			);
		}
		expect(actions).toEqual(["settlements.transition", "transactions.create"]);
	});
});
