import { BaselineStore } from "@ho/baseline";
import { loadConfig } from "./config-loader.js";

export interface CompareOptions {
	readonly config: string;
	readonly base: string;
	readonly target: string;
	readonly format: "md" | "json";
}

export interface MetricDiff {
	readonly base: number;
	readonly compare: number;
	readonly delta: number;
	readonly deltaPercent: number;
}

export interface ComparisonResult {
	readonly metrics: {
		readonly errorRate: MetricDiff;
		readonly avgLatency: MetricDiff;
		readonly avgCost: MetricDiff;
		readonly avgInputTokens: MetricDiff;
	};
}

export async function compare(
	options: CompareOptions,
): Promise<{ exitCode: number; output: string }> {
	const config = await loadConfig(options.config);
	const dbPath = config.baseline?.db_path;

	if (!dbPath) {
		return { exitCode: 1, output: "Error: No baseline.db_path configured" };
	}

	let store: BaselineStore;
	try {
		store = new BaselineStore({ dbPath });
	} catch (err) {
		return { exitCode: 1, output: `Error: Cannot open baseline DB: ${(err as Error).message}` };
	}

	try {
		const result = computeComparison(store, options.base, options.target);
		const output = formatComparison(result, options.format);
		const hasRegression = result.metrics.errorRate.deltaPercent > 10;
		return { exitCode: hasRegression ? 1 : 0, output };
	} finally {
		store.close();
	}
}

export function parseTimeWindow(spec: string): number {
	const match = spec.match(/^(\d+)([dhm])$/);
	if (!match) {
		throw new Error(`Invalid time window: "${spec}". Use format like 7d, 24h, 30m`);
	}

	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2]!;

	switch (unit) {
		case "d":
			return value * 24 * 60 * 60 * 1000;
		case "h":
			return value * 60 * 60 * 1000;
		case "m":
			return value * 60 * 1000;
		default:
			throw new Error(`Unknown time unit: ${unit}`);
	}
}

interface WindowMetrics {
	readonly avgLatency: number;
	readonly avgCost: number;
	readonly avgInputTokens: number;
	readonly errorRate: number;
	readonly count: number;
}

function queryWindowMetrics(store: BaselineStore, startMs: number, endMs: number): WindowMetrics {
	const db = (store as any).db;
	const row = db
		.prepare(`
		SELECT
			COALESCE(AVG(latency_ms), 0) as avg_latency,
			COALESCE(AVG(cost_usd), 0) as avg_cost,
			COALESCE(AVG(input_tokens), 0) as avg_input_tokens,
			COUNT(*) as total,
			SUM(CASE WHEN error_category IS NOT NULL THEN 1 ELSE 0 END) as error_count
		FROM span_metrics
		WHERE timestamp_ms >= ? AND timestamp_ms < ?
	`)
		.get(startMs, endMs) as {
		avg_latency: number;
		avg_cost: number;
		avg_input_tokens: number;
		total: number;
		error_count: number;
	};

	return {
		avgLatency: row.avg_latency,
		avgCost: row.avg_cost,
		avgInputTokens: row.avg_input_tokens,
		errorRate: row.total > 0 ? row.error_count / row.total : 0,
		count: row.total,
	};
}

function computeDiff(base: number, compare: number): MetricDiff {
	const delta = compare - base;
	const deltaPercent = base === 0 ? (compare === 0 ? 0 : 100) : (delta / base) * 100;
	return { base, compare, delta, deltaPercent };
}

export function computeComparison(
	store: BaselineStore,
	baseSpec: string,
	targetSpec: string,
): ComparisonResult {
	const now = Date.now();
	const baseMs = parseTimeWindow(baseSpec);
	const targetMs = parseTimeWindow(targetSpec);

	const baseMetrics = queryWindowMetrics(store, now - baseMs, now);
	const targetMetrics = queryWindowMetrics(store, now - targetMs, now);

	return {
		metrics: {
			errorRate: computeDiff(baseMetrics.errorRate, targetMetrics.errorRate),
			avgLatency: computeDiff(baseMetrics.avgLatency, targetMetrics.avgLatency),
			avgCost: computeDiff(baseMetrics.avgCost, targetMetrics.avgCost),
			avgInputTokens: computeDiff(baseMetrics.avgInputTokens, targetMetrics.avgInputTokens),
		},
	};
}

export function formatComparison(result: ComparisonResult, format: "md" | "json"): string {
	if (format === "json") {
		return JSON.stringify(result, null, 2);
	}

	const { metrics } = result;
	const lines = [
		"## Comparison Results",
		"",
		"| Metric | Base | Target | Delta | Delta % |",
		"|--------|------|--------|-------|---------|",
		formatRow("Error Rate", metrics.errorRate),
		formatRow("Avg Latency (ms)", metrics.avgLatency),
		formatRow("Avg Cost (USD)", metrics.avgCost),
		formatRow("Avg Input Tokens", metrics.avgInputTokens),
	];

	return lines.join("\n");
}

function formatRow(label: string, diff: MetricDiff): string {
	return `| ${label} | ${diff.base.toFixed(4)} | ${diff.compare.toFixed(4)} | ${diff.delta.toFixed(4)} | ${diff.deltaPercent.toFixed(1)}% |`;
}
