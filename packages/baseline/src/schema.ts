import type Database from "better-sqlite3";

export function initializeSchema(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS span_metrics (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp_ms INTEGER NOT NULL,
			trace_id TEXT NOT NULL,
			model TEXT NOT NULL DEFAULT '',
			tool TEXT NOT NULL DEFAULT '',
			error_category TEXT,
			latency_ms REAL NOT NULL,
			input_tokens INTEGER NOT NULL DEFAULT 0,
			output_tokens INTEGER NOT NULL DEFAULT 0,
			cost_usd REAL NOT NULL DEFAULT 0,
			harness_version TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_metrics_time ON span_metrics(timestamp_ms);
		CREATE INDEX IF NOT EXISTS idx_metrics_model_tool ON span_metrics(model, tool);

		CREATE TABLE IF NOT EXISTS baselines (
			model TEXT NOT NULL,
			tool TEXT NOT NULL,
			metric TEXT NOT NULL,
			sample_count INTEGER NOT NULL,
			mean REAL NOT NULL,
			stddev REAL NOT NULL,
			p50 REAL NOT NULL,
			p95 REAL NOT NULL,
			p99 REAL NOT NULL,
			computed_at_ms INTEGER NOT NULL,
			PRIMARY KEY (model, tool, metric)
		);

		CREATE TABLE IF NOT EXISTS unknown_errors (
			fingerprint TEXT PRIMARY KEY,
			first_seen_ms INTEGER NOT NULL,
			last_seen_ms INTEGER NOT NULL,
			occurrence_count INTEGER NOT NULL DEFAULT 1,
			sample_message TEXT NOT NULL,
			sample_trace_id TEXT NOT NULL,
			sample_model TEXT,
			sample_tool TEXT,
			ticket_id TEXT,
			ticket_url TEXT
		);

		CREATE TABLE IF NOT EXISTS alert_windows (
			rule_name TEXT PRIMARY KEY,
			window_json TEXT NOT NULL,
			updated_at_ms INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS alert_cooldowns (
			rule_name TEXT PRIMARY KEY,
			last_fired_ms INTEGER NOT NULL
		);
	`);
}
