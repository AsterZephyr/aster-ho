import type { BaselineStats } from "@ho/baseline";

export interface RecordingRuleConfig {
	readonly prefix?: string;
	readonly evaluation_interval?: string;
}

export interface BaselineInput {
	readonly model: string;
	readonly tool: string;
	readonly metric: string;
	readonly stats: BaselineStats;
}

export function generateRecordingRules(
	baselines: readonly BaselineInput[],
	config?: RecordingRuleConfig,
): string {
	const prefix = config?.prefix ?? "ho";
	const interval = config?.evaluation_interval ?? "1m";

	const rules = baselines.flatMap((entry) => buildRulesForEntry(entry, prefix));

	const lines = [
		"groups:",
		`  - name: ${prefix}_baselines`,
		`    interval: ${interval}`,
		"    rules:",
		...rules,
	];

	return lines.join("\n") + "\n";
}

function buildRulesForEntry(entry: BaselineInput, prefix: string): string[] {
	const labels = `model="${entry.model}",tool="${entry.tool}"`;

	return [
		formatRule(prefix, entry.metric, "mean", labels, entry.stats.mean),
		formatRule(prefix, entry.metric, "p95", labels, entry.stats.p95),
		formatRule(prefix, entry.metric, "stddev", labels, entry.stats.stddev),
	];
}

function formatRule(
	prefix: string,
	metric: string,
	stat: string,
	labels: string,
	value: number,
): string {
	return [
		`      - record: ${prefix}:${metric}:${stat}{${labels}}`,
		`        expr: ${value}`,
	].join("\n");
}
