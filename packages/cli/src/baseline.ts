import { BaselineStore } from "@ho/baseline";
import type { BaselineStats } from "@ho/baseline";
import { loadConfig } from "./config-loader.js";

export interface BaselineShowOptions {
	readonly config: string;
	readonly model?: string;
	readonly tool?: string;
	readonly format: "md" | "json";
}

export async function baselineShow(
	options: BaselineShowOptions,
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
		const results = queryBaselines(store, options.model, options.tool);
		const output = formatBaselines(results, options.format);
		return { exitCode: 0, output };
	} finally {
		store.close();
	}
}

export async function baselineRecompute(
	options: { config: string },
): Promise<{ exitCode: number; output: string }> {
	const config = await loadConfig(options.config);
	const dbPath = config.baseline?.db_path;

	if (!dbPath) {
		return { exitCode: 1, output: "Error: No baseline.db_path configured" };
	}

	let store: BaselineStore;
	try {
		store = new BaselineStore({ dbPath, retentionDays: config.baseline?.retention_days });
	} catch (err) {
		return { exitCode: 1, output: `Error: Cannot open baseline DB: ${(err as Error).message}` };
	}

	try {
		store.recomputeBaselines();
		return { exitCode: 0, output: "Baselines recomputed successfully" };
	} finally {
		store.close();
	}
}

interface BaselineRow {
	readonly model: string;
	readonly tool: string;
	readonly metric: string;
	readonly stats: BaselineStats;
}

const METRICS = ["latency_ms", "input_tokens", "output_tokens", "cost_usd"] as const;

function queryBaselines(
	store: BaselineStore,
	model?: string,
	tool?: string,
): readonly BaselineRow[] {
	const results: BaselineRow[] = [];
	const models = model ? [model] : [""];
	const tools = tool ? [tool] : [""];

	for (const m of models) {
		for (const t of tools) {
			for (const metric of METRICS) {
				const stats = store.getBaseline({ model: m, tool: t }, metric);
				if (stats) {
					results.push({ model: m, tool: t, metric, stats });
				}
			}
		}
	}

	return results;
}

export function formatBaselines(
	baselines: readonly BaselineRow[],
	format: "md" | "json",
): string {
	if (baselines.length === 0) {
		return format === "json" ? "[]" : "No baselines found.";
	}

	if (format === "json") {
		return JSON.stringify(baselines, null, 2);
	}

	const header = "| Model | Tool | Metric | Mean | P95 | Stddev | Count |";
	const sep = "|-------|------|--------|------|-----|--------|-------|";
	const rows = baselines.map(
		(b) =>
			`| ${b.model} | ${b.tool} | ${b.metric} | ${b.stats.mean.toFixed(2)} | ${b.stats.p95.toFixed(2)} | ${b.stats.stddev.toFixed(2)} | ${b.stats.count} |`,
	);

	return [header, sep, ...rows].join("\n");
}
