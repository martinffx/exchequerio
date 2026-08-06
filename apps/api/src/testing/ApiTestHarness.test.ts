import { describe, expect, it, vi } from "vitest";
import { makeIdempotentCleanup, runCleanupSteps } from "./ApiTestHarness";

describe("API test harness cleanup", () => {
	it("attempts every cleanup step and reports all failures", async () => {
		const first = vi.fn();
		const second = vi.fn(() => Promise.reject(new Error("second failed")));
		const third = vi.fn(() => {
			throw new Error("third failed");
		});
		const fourth = vi.fn();

		const failure = await runCleanupSteps([first, second, third, fourth]).catch(
			(error: unknown) => error
		);
		expect(failure).toBeInstanceOf(AggregateError);
		expect((failure as AggregateError).errors as unknown[]).toHaveLength(2);
		expect([first, second, third, fourth].every(step => step.mock.calls.length === 1)).toBe(true);
	});

	it("runs cleanup only once when close is called repeatedly", async () => {
		const step = vi.fn();
		const close = makeIdempotentCleanup([step]);

		await Promise.all([close(), close()]);
		await close();

		expect(step).toHaveBeenCalledOnce();
	});
});
