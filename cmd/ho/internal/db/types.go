package db

type BaselineStats struct {
	Model       string  `json:"model"`
	Tool        string  `json:"tool"`
	Metric      string  `json:"metric"`
	SampleCount int     `json:"sample_count"`
	Mean        float64 `json:"mean"`
	Stddev      float64 `json:"stddev"`
	P50         float64 `json:"p50"`
	P95         float64 `json:"p95"`
	P99         float64 `json:"p99"`
	ComputedAt  int64   `json:"computed_at_ms"`
}

type SpanMetric struct {
	ID            int64    `json:"id"`
	TimestampMs   int64    `json:"timestamp_ms"`
	TraceID       string   `json:"trace_id"`
	Model         string   `json:"model"`
	Tool          string   `json:"tool"`
	ErrorCategory *string  `json:"error_category"`
	LatencyMs     float64  `json:"latency_ms"`
	InputTokens   int      `json:"input_tokens"`
	OutputTokens  int      `json:"output_tokens"`
	CostUsd       float64  `json:"cost_usd"`
	HarnessVer    *string  `json:"harness_version"`
}

type UnknownError struct {
	Fingerprint string  `json:"fingerprint"`
	FirstSeen   int64   `json:"first_seen_ms"`
	LastSeen    int64   `json:"last_seen_ms"`
	Count       int     `json:"occurrence_count"`
	Message     string  `json:"sample_message"`
	TraceID     string  `json:"sample_trace_id"`
	Model       *string `json:"sample_model"`
	Tool        *string `json:"sample_tool"`
	TicketID    *string `json:"ticket_id"`
}

type WindowMetrics struct {
	AvgLatency     float64 `json:"avg_latency"`
	AvgCost        float64 `json:"avg_cost"`
	AvgInputTokens float64 `json:"avg_input_tokens"`
	ErrorRate      float64 `json:"error_rate"`
	TotalSpans     int     `json:"total_spans"`
	TotalErrors    int     `json:"total_errors"`
}
