package compare

import (
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/config"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/db"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/output"
	"github.com/spf13/cobra"
)

type MetricDiff struct {
	Base         float64 `json:"base"`
	Compare      float64 `json:"compare"`
	Delta        float64 `json:"delta"`
	DeltaPercent float64 `json:"delta_percent"`
}

type ComparisonResult struct {
	ErrorRate      MetricDiff `json:"error_rate"`
	AvgLatency     MetricDiff `json:"avg_latency"`
	AvgCost        MetricDiff `json:"avg_cost"`
	AvgInputTokens MetricDiff `json:"avg_input_tokens"`
}

func NewCmd() *cobra.Command {
	var (
		cfgPath    string
		baseSpec   string
		targetSpec string
		format     string
	)

	cmd := &cobra.Command{
		Use:   "compare",
		Short: "Compare metrics between two time windows",
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

			result, err := computeComparison(store, baseSpec, targetSpec)
			if err != nil {
				return err
			}

			out, err := formatComparison(result, format)
			if err != nil {
				return err
			}
			fmt.Print(out)

			if result.ErrorRate.DeltaPercent > 10 {
				return fmt.Errorf("error rate regression detected: %.1f%%", result.ErrorRate.DeltaPercent)
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&cfgPath, "config", "c", config.DefaultConfigPath(), "config file path")
	cmd.Flags().StringVar(&baseSpec, "base", "7d", "base time window (e.g. 7d, 24h)")
	cmd.Flags().StringVar(&targetSpec, "target", "1d", "target time window (e.g. 1d, 6h)")
	cmd.Flags().StringVarP(&format, "format", "f", "md", "output format (md|json)")
	return cmd
}

var windowRegex = regexp.MustCompile(`^(\d+)([dhm])$`)

func ParseTimeWindow(spec string) (int64, error) {
	m := windowRegex.FindStringSubmatch(spec)
	if m == nil {
		return 0, fmt.Errorf("invalid time window: %q (use format like 7d, 24h, 30m)", spec)
	}
	value, _ := strconv.ParseInt(m[1], 10, 64)
	switch m[2] {
	case "d":
		return value * 24 * 60 * 60 * 1000, nil
	case "h":
		return value * 60 * 60 * 1000, nil
	case "m":
		return value * 60 * 1000, nil
	}
	return 0, fmt.Errorf("unknown time unit: %s", m[2])
}

func computeComparison(store *db.Store, baseSpec, targetSpec string) (*ComparisonResult, error) {
	now := time.Now().UnixMilli()

	baseMs, err := ParseTimeWindow(baseSpec)
	if err != nil {
		return nil, err
	}
	targetMs, err := ParseTimeWindow(targetSpec)
	if err != nil {
		return nil, err
	}

	baseMetrics, err := store.GetWindowMetrics(now-baseMs, now)
	if err != nil {
		return nil, err
	}
	targetMetrics, err := store.GetWindowMetrics(now-targetMs, now)
	if err != nil {
		return nil, err
	}

	return &ComparisonResult{
		ErrorRate:      computeDiff(baseMetrics.ErrorRate, targetMetrics.ErrorRate),
		AvgLatency:     computeDiff(baseMetrics.AvgLatency, targetMetrics.AvgLatency),
		AvgCost:        computeDiff(baseMetrics.AvgCost, targetMetrics.AvgCost),
		AvgInputTokens: computeDiff(baseMetrics.AvgInputTokens, targetMetrics.AvgInputTokens),
	}, nil
}

func computeDiff(base, compare float64) MetricDiff {
	delta := compare - base
	var pct float64
	if base == 0 {
		if compare == 0 {
			pct = 0
		} else {
			pct = 100
		}
	} else {
		pct = (delta / base) * 100
	}
	return MetricDiff{Base: base, Compare: compare, Delta: delta, DeltaPercent: pct}
}

func formatComparison(result *ComparisonResult, format string) (string, error) {
	if format == "json" {
		return output.FormatJSON(result)
	}

	header := []string{"Metric", "Base", "Target", "Delta", "Delta %"}
	rows := [][]string{
		formatRow("Error Rate", result.ErrorRate),
		formatRow("Avg Latency (ms)", result.AvgLatency),
		formatRow("Avg Cost (USD)", result.AvgCost),
		formatRow("Avg Input Tokens", result.AvgInputTokens),
	}

	return "## Comparison Results\n\n" + output.FormatTable(header, rows), nil
}

func formatRow(label string, diff MetricDiff) []string {
	return []string{
		label,
		output.Fmtf(diff.Base, 4),
		output.Fmtf(diff.Compare, 4),
		output.Fmtf(diff.Delta, 4),
		fmt.Sprintf("%.1f%%", diff.DeltaPercent),
	}
}
