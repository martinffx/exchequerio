import { describe, expect, it } from "vitest";
import { sample } from "@/lib/LoadShedding";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const calm = { heapUsed: 100 * MB, rss: 200 * MB };
const nsFor = (delayMs: number, resolutionMs = 10) => (delayMs + resolutionMs) * 1e6;

describe("sample", () => {
	it.each([
		["delay just under", nsFor(999), calm, false],
		["delay just over", nsFor(1001), calm, true],
		["heap just under", nsFor(0), { ...calm, heapUsed: 500 * MB }, false],
		["heap just over", nsFor(0), { ...calm, heapUsed: 500 * MB + 1 }, true],
		["rss just under", nsFor(0), { ...calm, rss: GB }, false],
		["rss just over", nsFor(0), { ...calm, rss: GB + 1 }, true],
	])("%s", (_name, meanNs, memory, expected) => {
		expect(sample(meanNs, 10, memory)).toBe(expected);
	});

	it("treats a NaN histogram mean as overloaded", () => {
		expect(sample(Number.NaN, 10, calm)).toBe(true);
	});

	it("subtracts the resolution from the mean before comparing", () => {
		// mean 1005 ms with 10 ms resolution is 995 ms of delay
		expect(sample(1005 * 1e6, 10, calm)).toBe(false);
		expect(sample(1005 * 1e6, 0, calm)).toBe(true);
	});
});
