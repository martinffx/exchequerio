export const MAX_EVENT_LOOP_DELAY_MS = 1000;
export const MAX_HEAP_USED_BYTES = 500 * 1024 * 1024;
export const MAX_RSS_BYTES = 1024 * 1024 * 1024;

/** Pure: true when the process is overloaded. The histogram mean is in nanoseconds. */
export const sample = (
	histogramMeanNs: number,
	resolutionMs: number,
	memoryUsage: Pick<NodeJS.MemoryUsage, "heapUsed" | "rss">
): boolean => {
	const delayMs = histogramMeanNs / 1e6 - resolutionMs;
	return (
		Number.isNaN(delayMs) ||
		delayMs > MAX_EVENT_LOOP_DELAY_MS ||
		memoryUsage.heapUsed > MAX_HEAP_USED_BYTES ||
		memoryUsage.rss > MAX_RSS_BYTES
	);
};
