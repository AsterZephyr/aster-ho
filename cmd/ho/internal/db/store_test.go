package db

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *Store {
	t.Helper()
	rawDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	rawDB.Exec(`
		CREATE TABLE span_metrics (
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
		CREATE TABLE baselines (
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
		CREATE TABLE unknown_errors (
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
	`)
	return &Store{db: rawDB}
}

func TestGetBaselinesEmpty(t *testing.T) {
	store := setupTestDB(t)
	defer store.Close()

	baselines, err := store.GetBaselines("", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(baselines) != 0 {
		t.Errorf("expected empty, got %d", len(baselines))
	}
}

func TestGetBaselinesWithData(t *testing.T) {
	store := setupTestDB(t)
	defer store.Close()

	store.db.Exec(`INSERT INTO baselines VALUES ('gpt-4', '', 'latency_ms', 100, 250.0, 50.0, 240.0, 350.0, 400.0, 1700000000000)`)
	store.db.Exec(`INSERT INTO baselines VALUES ('gpt-4', '', 'cost_usd', 100, 0.05, 0.01, 0.04, 0.08, 0.10, 1700000000000)`)

	baselines, err := store.GetBaselines("gpt-4", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(baselines) != 2 {
		t.Errorf("expected 2, got %d", len(baselines))
	}
	found := false
	for _, b := range baselines {
		if b.Metric == "latency_ms" && b.Mean == 250.0 {
			found = true
		}
	}
	if !found {
		t.Errorf("expected latency_ms baseline with mean 250, got %+v", baselines)
	}
}

func TestGetWindowMetrics(t *testing.T) {
	store := setupTestDB(t)
	defer store.Close()

	store.db.Exec(`INSERT INTO span_metrics (timestamp_ms, trace_id, model, tool, latency_ms, input_tokens, output_tokens, cost_usd) VALUES (1000, 't1', 'gpt-4', '', 100, 50, 20, 0.01)`)
	store.db.Exec(`INSERT INTO span_metrics (timestamp_ms, trace_id, model, tool, error_category, latency_ms, input_tokens, output_tokens, cost_usd) VALUES (2000, 't2', 'gpt-4', '', 'timeout', 500, 100, 0, 0.05)`)

	m, err := store.GetWindowMetrics(0, 10000)
	if err != nil {
		t.Fatal(err)
	}
	if m.TotalSpans != 2 {
		t.Errorf("total: got %d, want 2", m.TotalSpans)
	}
	if m.TotalErrors != 1 {
		t.Errorf("errors: got %d, want 1", m.TotalErrors)
	}
	if m.ErrorRate != 0.5 {
		t.Errorf("error rate: got %f, want 0.5", m.ErrorRate)
	}
}

func TestRecomputeBaselines(t *testing.T) {
	store := setupTestDB(t)
	defer store.Close()

	for i := 0; i < 10; i++ {
		store.db.Exec(`INSERT INTO span_metrics (timestamp_ms, trace_id, model, tool, latency_ms, input_tokens, output_tokens, cost_usd) VALUES (?, ?, 'gpt-4', 'web_search', ?, 100, 50, 0.01)`,
			int64(i)*1000+1000, "trace-"+string(rune('a'+i)), float64(i)*10+100)
	}

	if err := store.RecomputeBaselines(0); err != nil {
		t.Fatal(err)
	}

	baselines, err := store.GetBaselines("gpt-4", "web_search")
	if err != nil {
		t.Fatal(err)
	}
	if len(baselines) != 4 {
		t.Errorf("expected 4 metrics, got %d", len(baselines))
	}
}

func TestGetUnknownErrors(t *testing.T) {
	store := setupTestDB(t)
	defer store.Close()

	store.db.Exec(`INSERT INTO unknown_errors (fingerprint, first_seen_ms, last_seen_ms, occurrence_count, sample_message, sample_trace_id) VALUES ('fp1', 1000, 5000, 3, 'timeout error', 't1')`)

	errors, err := store.GetUnknownErrors(1, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(errors) != 1 {
		t.Errorf("expected 1, got %d", len(errors))
	}
	if errors[0].Count != 3 {
		t.Errorf("count: got %d, want 3", errors[0].Count)
	}
}
