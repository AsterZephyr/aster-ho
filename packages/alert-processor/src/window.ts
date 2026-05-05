import type { WindowBucket } from "./types.js";

export interface WindowState {
	readonly buckets: readonly WindowBucket[];
	readonly windowMs: number;
	readonly bucketMs: number;
}

export function createWindow(windowMs: number, bucketCount = 10): WindowState {
	return {
		buckets: [],
		windowMs,
		bucketMs: Math.max(windowMs / bucketCount, 100),
	};
}

export function pushMetric(
	state: WindowState,
	now: number,
	metric: { isError: boolean; latencyMs: number; costUsd: number },
): WindowState {
	const bucketTime = Math.floor(now / state.bucketMs) * state.bucketMs;
	const cutoff = now - state.windowMs;

	const activeBuckets = state.buckets.filter((b) => b.timestamp >= cutoff);

	const existing = activeBuckets.find((b) => b.timestamp === bucketTime);
	if (existing) {
		const updated: WindowBucket = {
			timestamp: existing.timestamp,
			spanCount: existing.spanCount + 1,
			errorCount: existing.errorCount + (metric.isError ? 1 : 0),
			latencySum: existing.latencySum + metric.latencyMs,
			costSum: existing.costSum + metric.costUsd,
		};
		return {
			...state,
			buckets: activeBuckets.map((b) => (b.timestamp === bucketTime ? updated : b)),
		};
	}

	const newBucket: WindowBucket = {
		timestamp: bucketTime,
		spanCount: 1,
		errorCount: metric.isError ? 1 : 0,
		latencySum: metric.latencyMs,
		costSum: metric.costUsd,
	};

	return { ...state, buckets: [...activeBuckets, newBucket] };
}

export function getMetricValue(state: WindowState, metric: string): number {
	const totalSpans = state.buckets.reduce((s, b) => s + b.spanCount, 0);
	const totalErrors = state.buckets.reduce((s, b) => s + b.errorCount, 0);
	const totalLatency = state.buckets.reduce((s, b) => s + b.latencySum, 0);
	const totalCost = state.buckets.reduce((s, b) => s + b.costSum, 0);

	switch (metric) {
		case "error_rate":
			return totalSpans > 0 ? totalErrors / totalSpans : 0;
		case "latency_avg":
			return totalSpans > 0 ? totalLatency / totalSpans : 0;
		case "cost_total":
			return totalCost;
		case "span_count":
			return totalSpans;
		default:
			return 0;
	}
}
