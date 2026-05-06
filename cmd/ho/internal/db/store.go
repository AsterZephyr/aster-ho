package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("set WAL mode: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) GetBaselines(model, tool string) ([]BaselineStats, error) {
	query := `SELECT model, tool, metric, sample_count, mean, stddev, p50, p95, p99, computed_at_ms FROM baselines WHERE 1=1`
	args := []any{}

	if model != "" {
		query += " AND model = ?"
		args = append(args, model)
	}
	if tool != "" {
		query += " AND tool = ?"
		args = append(args, tool)
	}
	query += " ORDER BY model, tool, metric"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query baselines: %w", err)
	}
	defer rows.Close()

	var results []BaselineStats
	for rows.Next() {
		var b BaselineStats
		if err := rows.Scan(&b.Model, &b.Tool, &b.Metric, &b.SampleCount, &b.Mean, &b.Stddev, &b.P50, &b.P95, &b.P99, &b.ComputedAt); err != nil {
			return nil, fmt.Errorf("scan baseline: %w", err)
		}
		results = append(results, b)
	}
	return results, rows.Err()
}

func (s *Store) GetWindowMetrics(startMs, endMs int64) (WindowMetrics, error) {
	row := s.db.QueryRow(`
		SELECT
			COALESCE(AVG(latency_ms), 0),
			COALESCE(AVG(cost_usd), 0),
			COALESCE(AVG(input_tokens), 0),
			COUNT(*),
			SUM(CASE WHEN error_category IS NOT NULL THEN 1 ELSE 0 END)
		FROM span_metrics
		WHERE timestamp_ms >= ? AND timestamp_ms < ?
	`, startMs, endMs)

	var m WindowMetrics
	if err := row.Scan(&m.AvgLatency, &m.AvgCost, &m.AvgInputTokens, &m.TotalSpans, &m.TotalErrors); err != nil {
		return m, fmt.Errorf("query window metrics: %w", err)
	}
	if m.TotalSpans > 0 {
		m.ErrorRate = float64(m.TotalErrors) / float64(m.TotalSpans)
	}
	return m, nil
}

func (s *Store) GetUnknownErrors(minCount int, sinceMs int64) ([]UnknownError, error) {
	rows, err := s.db.Query(`
		SELECT fingerprint, first_seen_ms, last_seen_ms, occurrence_count, sample_message, sample_trace_id, sample_model, sample_tool, ticket_id
		FROM unknown_errors
		WHERE occurrence_count >= ? AND last_seen_ms >= ?
		ORDER BY occurrence_count DESC
	`, minCount, sinceMs)
	if err != nil {
		return nil, fmt.Errorf("query unknown errors: %w", err)
	}
	defer rows.Close()

	var results []UnknownError
	for rows.Next() {
		var e UnknownError
		if err := rows.Scan(&e.Fingerprint, &e.FirstSeen, &e.LastSeen, &e.Count, &e.Message, &e.TraceID, &e.Model, &e.Tool, &e.TicketID); err != nil {
			return nil, fmt.Errorf("scan unknown error: %w", err)
		}
		results = append(results, e)
	}
	return results, rows.Err()
}

func (s *Store) RecomputeBaselines(cutoffMs int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	groups, err := s.queryGroups(tx, cutoffMs)
	if err != nil {
		return err
	}

	for _, g := range groups {
		if err := s.computeGroupBaselines(tx, g.Model, g.Tool, cutoffMs); err != nil {
			return err
		}
	}

	return tx.Commit()
}

type modelTool struct {
	Model string
	Tool  string
}

func (s *Store) queryGroups(tx *sql.Tx, cutoffMs int64) ([]modelTool, error) {
	rows, err := tx.Query("SELECT DISTINCT model, tool FROM span_metrics WHERE timestamp_ms >= ?", cutoffMs)
	if err != nil {
		return nil, fmt.Errorf("query groups: %w", err)
	}
	defer rows.Close()

	var groups []modelTool
	for rows.Next() {
		var g modelTool
		if err := rows.Scan(&g.Model, &g.Tool); err != nil {
			return nil, fmt.Errorf("scan group: %w", err)
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

func (s *Store) computeGroupBaselines(tx *sql.Tx, model, tool string, cutoffMs int64) error {
	rows, err := tx.Query(`
		SELECT latency_ms, input_tokens, output_tokens, cost_usd
		FROM span_metrics
		WHERE model = ? AND tool = ? AND timestamp_ms >= ?
	`, model, tool, cutoffMs)
	if err != nil {
		return fmt.Errorf("query metrics for %s/%s: %w", model, tool, err)
	}
	defer rows.Close()

	var latencies, inputs, outputs, costs []float64
	for rows.Next() {
		var lat, cost float64
		var inp, out int
		if err := rows.Scan(&lat, &inp, &out, &cost); err != nil {
			return fmt.Errorf("scan metric: %w", err)
		}
		latencies = append(latencies, lat)
		inputs = append(inputs, float64(inp))
		outputs = append(outputs, float64(out))
		costs = append(costs, cost)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if len(latencies) == 0 {
		return nil
	}

	now := currentTimeMs()
	metrics := map[string][]float64{
		"latency_ms":   latencies,
		"input_tokens":  inputs,
		"output_tokens": outputs,
		"cost_usd":      costs,
	}

	stmt, err := tx.Prepare(`
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
	`)
	if err != nil {
		return fmt.Errorf("prepare upsert: %w", err)
	}
	defer stmt.Close()

	for metric, values := range metrics {
		stats := computeStats(values)
		if _, err := stmt.Exec(model, tool, metric, len(values), stats.Mean, stats.Stddev, stats.P50, stats.P95, stats.P99, now); err != nil {
			return fmt.Errorf("upsert baseline %s: %w", metric, err)
		}
	}

	return nil
}
