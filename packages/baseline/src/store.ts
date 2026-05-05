import Database from "better-sqlite3";
import { initializeSchema } from "./schema.js";
import type {
	AnomalyResult,
	BaselineKey,
	BaselineStats,
	BaselineStoreConfig,
	MetricEntry,
	UnknownErrorRecord,
} from "./types.js";

const METRICS = ["latency_ms", "input_tokens", "output_tokens", "cost_usd"] as const;

function computePercentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const index = (p / 100) * (sorted.length - 1);
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower]!;
	const weight = index - lower;
	return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export class BaselineStore {
	private readonly db: Database.Database;
	private readonly retentionDays: number;

	constructor(config: BaselineStoreConfig) {
		this.db = new Database(config.dbPath);
		this.db.pragma("journal_mode = WAL");
		this.retentionDays = config.retentionDays ?? 90;
		initializeSchema(this.db);
	}

	recordMetric(entry: MetricEntry): void {
		const stmt = this.db.prepare(`
			INSERT INTO span_metrics (timestamp_ms, trace_id, model, tool, error_category, latency_ms, input_tokens, output_tokens, cost_usd, harness_version)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		stmt.run(
			entry.timestamp,
			entry.traceId,
			entry.model,
			entry.tool,
			entry.errorCategory ?? null,
			entry.latencyMs,
			entry.inputTokens,
			entry.outputTokens,
			entry.costUsd,
			entry.harnessVersion ?? null,
		);
	}

	getBaseline(key: BaselineKey, metric: string): BaselineStats | undefined {
		const stmt = this.db.prepare(`
			SELECT sample_count, mean, stddev, p50, p95, p99, computed_at_ms
			FROM baselines
			WHERE model = ? AND tool = ? AND metric = ?
		`);
		const row = stmt.get(key.model, key.tool, metric) as
			| { sample_count: number; mean: number; stddev: number; p50: number; p95: number; p99: number; computed_at_ms: number }
			| undefined;

		if (!row) return undefined;

		return {
			count: row.sample_count,
			mean: row.mean,
			stddev: row.stddev,
			p50: row.p50,
			p95: row.p95,
			p99: row.p99,
			lastUpdated: row.computed_at_ms,
		};
	}

	isAnomaly(key: BaselineKey, metric: string, value: number, zscoreThreshold: number): AnomalyResult {
		const baseline = this.getBaseline(key, metric);
		if (!baseline) {
			return {
				anomalous: false,
				zscore: 0,
				baseline: { count: 0, mean: 0, stddev: 0, p50: 0, p95: 0, p99: 0, lastUpdated: 0 },
			};
		}

		const zscore = baseline.stddev === 0 ? 0 : Math.abs(value - baseline.mean) / baseline.stddev;

		return {
			anomalous: zscore > zscoreThreshold,
			zscore,
			baseline,
		};
	}

	recomputeBaselines(periodMs?: number): void {
		const cutoff = periodMs
			? Date.now() - periodMs
			: Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;

		const groups = this.db.prepare(`
			SELECT DISTINCT model, tool FROM span_metrics WHERE timestamp_ms >= ?
		`).all(cutoff) as Array<{ model: string; tool: string }>;

		const now = Date.now();
		const upsertStmt = this.db.prepare(`
			INSERT INTO baselines (model, tool, metric, sample_count, mean, stddev, p50, p95, p99, computed_at_ms)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(model, tool, metric) DO UPDATE SET
				sample_count = excluded.sample_count,
				mean = excluded.mean,
				stddev = excluded.stddev,
				p50 = excluded.p50,
				p95 = excluded.p95,
				p99 = excluded.p99,
				computed_at_ms = excluded.computed_at_ms
		`);

		const selectStmt = this.db.prepare(`
			SELECT latency_ms, input_tokens, output_tokens, cost_usd
			FROM span_metrics
			WHERE model = ? AND tool = ? AND timestamp_ms >= ?
		`);

		const transaction = this.db.transaction(() => {
			for (const group of groups) {
				const rows = selectStmt.all(group.model, group.tool, cutoff) as Array<{
					latency_ms: number;
					input_tokens: number;
					output_tokens: number;
					cost_usd: number;
				}>;

				if (rows.length === 0) continue;

				for (const metric of METRICS) {
					const values = rows.map((r) => r[metric]).sort((a, b) => a - b);
					const count = values.length;
					const sum = values.reduce((acc, v) => acc + v, 0);
					const mean = sum / count;
					const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count;
					const stddev = Math.sqrt(variance);
					const p50 = computePercentile(values, 50);
					const p95 = computePercentile(values, 95);
					const p99 = computePercentile(values, 99);

					upsertStmt.run(group.model, group.tool, metric, count, mean, stddev, p50, p95, p99, now);
				}
			}
		});

		transaction();
	}

	recordUnknownError(entry: {
		fingerprint: string;
		message: string;
		traceId: string;
		model?: string;
		tool?: string;
		timestamp: number;
	}): void {
		const stmt = this.db.prepare(`
			INSERT INTO unknown_errors (fingerprint, first_seen_ms, last_seen_ms, occurrence_count, sample_message, sample_trace_id, sample_model, sample_tool)
			VALUES (?, ?, ?, 1, ?, ?, ?, ?)
			ON CONFLICT(fingerprint) DO UPDATE SET
				last_seen_ms = excluded.last_seen_ms,
				occurrence_count = occurrence_count + 1
		`);
		stmt.run(
			entry.fingerprint,
			entry.timestamp,
			entry.timestamp,
			entry.message,
			entry.traceId,
			entry.model ?? null,
			entry.tool ?? null,
		);
	}

	getUnknownErrors(minCount?: number): UnknownErrorRecord[] {
		const threshold = minCount ?? 1;
		const stmt = this.db.prepare(`
			SELECT fingerprint, first_seen_ms, last_seen_ms, occurrence_count, sample_message, sample_trace_id, sample_model, sample_tool, ticket_id
			FROM unknown_errors
			WHERE occurrence_count >= ?
			ORDER BY occurrence_count DESC
		`);
		const rows = stmt.all(threshold) as Array<{
			fingerprint: string;
			first_seen_ms: number;
			last_seen_ms: number;
			occurrence_count: number;
			sample_message: string;
			sample_trace_id: string;
			sample_model: string | null;
			sample_tool: string | null;
			ticket_id: string | null;
		}>;

		return rows.map((row) => ({
			fingerprint: row.fingerprint,
			firstSeen: row.first_seen_ms,
			lastSeen: row.last_seen_ms,
			count: row.occurrence_count,
			sampleMessage: row.sample_message,
			sampleTraceId: row.sample_trace_id,
			sampleModel: row.sample_model ?? undefined,
			sampleTool: row.sample_tool ?? undefined,
			ticketId: row.ticket_id ?? undefined,
		}));
	}

	markTicketed(fingerprint: string, ticketId: string, ticketUrl: string): void {
		const stmt = this.db.prepare(`
			UPDATE unknown_errors SET ticket_id = ?, ticket_url = ? WHERE fingerprint = ?
		`);
		stmt.run(ticketId, ticketUrl, fingerprint);
	}

	close(): void {
		this.db.close();
	}
}
