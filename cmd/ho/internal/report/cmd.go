package report

import (
	"fmt"
	"time"

	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/compare"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/config"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/db"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/output"
	"github.com/spf13/cobra"
)

type Summary struct {
	PeriodStart       int64        `json:"period_start"`
	PeriodEnd         int64        `json:"period_end"`
	TotalSpans        int          `json:"total_spans"`
	TotalErrors       int          `json:"total_errors"`
	ErrorRate         float64      `json:"error_rate"`
	UnknownErrorCount int          `json:"unknown_error_count"`
	UnknownErrors     []ErrorEntry `json:"unknown_errors"`
}

type ErrorEntry struct {
	Fingerprint string `json:"fingerprint"`
	Count       int    `json:"count"`
	Message     string `json:"message"`
}

func NewCmd() *cobra.Command {
	var (
		cfgPath string
		since   string
		format  string
	)

	cmd := &cobra.Command{
		Use:   "report",
		Short: "Generate ops summary report",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load(cfgPath)
			if err != nil {
				return err
			}
			if cfg.Baseline == nil || cfg.Baseline.DBPath == "" {
				return fmt.Errorf("no baseline.db_path configured")
			}

			store, err := db.Open(cfg.Baseline.DBPath)
			if err != nil {
				return fmt.Errorf("cannot open baseline DB: %w", err)
			}
			defer store.Close()

			summary, err := buildSummary(store, since)
			if err != nil {
				return err
			}

			out, err := formatReport(summary, format)
			if err != nil {
				return err
			}
			fmt.Print(out)

			if summary.ErrorRate >= 0.1 {
				return fmt.Errorf("error rate %.2f%% exceeds threshold", summary.ErrorRate*100)
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&cfgPath, "config", "c", config.DefaultConfigPath(), "config file path")
	cmd.Flags().StringVar(&since, "since", "7d", "time window (e.g. 7d, 24h)")
	cmd.Flags().StringVarP(&format, "format", "f", "md", "output format (md|json)")
	return cmd
}

func buildSummary(store *db.Store, since string) (*Summary, error) {
	now := time.Now().UnixMilli()
	periodMs, err := compare.ParseTimeWindow(since)
	if err != nil {
		return nil, err
	}
	periodStart := now - periodMs

	metrics, err := store.GetWindowMetrics(periodStart, now)
	if err != nil {
		return nil, err
	}

	unknowns, err := store.GetUnknownErrors(1, periodStart)
	if err != nil {
		return nil, err
	}

	entries := make([]ErrorEntry, 0, len(unknowns))
	for _, e := range unknowns {
		entries = append(entries, ErrorEntry{
			Fingerprint: e.Fingerprint,
			Count:       e.Count,
			Message:     e.Message,
		})
	}

	return &Summary{
		PeriodStart:       periodStart,
		PeriodEnd:         now,
		TotalSpans:        metrics.TotalSpans,
		TotalErrors:       metrics.TotalErrors,
		ErrorRate:         metrics.ErrorRate,
		UnknownErrorCount: len(entries),
		UnknownErrors:     entries,
	}, nil
}

func formatReport(summary *Summary, format string) (string, error) {
	if format == "json" {
		return output.FormatJSON(summary)
	}

	start := time.UnixMilli(summary.PeriodStart).UTC().Format(time.RFC3339)
	end := time.UnixMilli(summary.PeriodEnd).UTC().Format(time.RFC3339)

	s := fmt.Sprintf("## Ops Summary Report\n\n**Period**: %s to %s\n\n", start, end)

	header := []string{"Metric", "Value"}
	rows := [][]string{
		{"Total Spans", fmt.Sprintf("%d", summary.TotalSpans)},
		{"Total Errors", fmt.Sprintf("%d", summary.TotalErrors)},
		{"Error Rate", fmt.Sprintf("%.2f%%", summary.ErrorRate*100)},
		{"Unknown Errors", fmt.Sprintf("%d", summary.UnknownErrorCount)},
	}
	s += output.FormatTable(header, rows)

	if len(summary.UnknownErrors) > 0 {
		s += "\n### Unknown Errors\n\n"
		errHeader := []string{"Fingerprint", "Count", "Message"}
		errRows := make([][]string, 0, len(summary.UnknownErrors))
		for _, e := range summary.UnknownErrors {
			errRows = append(errRows, []string{e.Fingerprint, fmt.Sprintf("%d", e.Count), e.Message})
		}
		s += output.FormatTable(errHeader, errRows)
	}

	return s, nil
}
