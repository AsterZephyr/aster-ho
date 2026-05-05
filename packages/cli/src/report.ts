import { BaselineStore } from "@ho/baseline";
import type { UnknownErrorRecord } from "@ho/baseline";
import { loadConfig } from "./config-loader.js";
import { parseTimeWindow } from "./compare.js";

export interface ReportOptions {
	readonly config: string;
	readonly since?: string;
	readonly format: "md" | "json";
}

export interface WeeklySummary {
	readonly periodStart: number;
	readonly periodEnd: number;
	readonly unknownErrorCount: number;
	readonly unknownErrors: Array<{ fingerprint: string; count: number; message: string }>;
	readonly totalSpans: number;
	readonly totalErrors: number;
	readonly errorRate: number;
}

export async function report(
	options: ReportOptions,
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
		const summary = buildSummary(store, options.since);
		const output = formatReport(summary, options.format);
		const exitCode = summary.errorRate < 0.1 ? 0 : 1;
		return { exitCode, output };
	} finally {
		store.close();
	}
}

export function buildSummary(store: BaselineStore, since?: string): WeeklySummary {
	const now = Date.now();
	const periodMs = since ? parseTimeWindow(since) : 7 * 24 * 60 * 60 * 1000;
	const periodStart = now - periodMs;

	const db = (store as any).db;
	const spanRow = db.prepare(`
		SELECT
			COUNT(*) as total,
			SUM(CASE WHEN error_category IS NOT NULL THEN 1 ELSE 0 END) as errors
		FROM span_metrics
		WHERE timestamp_ms >= ?
	`).get(periodStart) as { total: number; errors: number };

	const unknownErrors = store.getUnknownErrors(1)
		.filter((e: UnknownErrorRecord) => e.lastSeen >= periodStart)
		.map((e: UnknownErrorRecord) => ({
			fingerprint: e.fingerprint,
			count: e.count,
			message: e.sampleMessage,
		}));

	const totalSpans = spanRow.total;
	const totalErrors = spanRow.errors;
	const errorRate = totalSpans > 0 ? totalErrors / totalSpans : 0;

	return {
		periodStart,
		periodEnd: now,
		unknownErrorCount: unknownErrors.length,
		unknownErrors,
		totalSpans,
		totalErrors,
		errorRate,
	};
}

export function formatReport(summary: WeeklySummary, format: "md" | "json"): string {
	if (format === "json") {
		return JSON.stringify(summary, null, 2);
	}

	const lines = [
		"## Ops Summary Report",
		"",
		`**Period**: ${new Date(summary.periodStart).toISOString()} to ${new Date(summary.periodEnd).toISOString()}`,
		"",
		"| Metric | Value |",
		"|--------|-------|",
		`| Total Spans | ${summary.totalSpans} |`,
		`| Total Errors | ${summary.totalErrors} |`,
		`| Error Rate | ${(summary.errorRate * 100).toFixed(2)}% |`,
		`| Unknown Errors | ${summary.unknownErrorCount} |`,
	];

	if (summary.unknownErrors.length > 0) {
		lines.push("", "### Unknown Errors", "");
		lines.push("| Fingerprint | Count | Message |");
		lines.push("|-------------|-------|---------|");
		for (const err of summary.unknownErrors) {
			lines.push(`| ${err.fingerprint} | ${err.count} | ${err.message} |`);
		}
	}

	return lines.join("\n");
}
