package baseline

import (
	"fmt"

	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/config"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/db"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/output"
	"github.com/spf13/cobra"
)

func NewShowCmd() *cobra.Command {
	var (
		cfgPath string
		model   string
		tool    string
		format  string
	)

	cmd := &cobra.Command{
		Use:   "show",
		Short: "Show computed baselines",
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

			baselines, err := store.GetBaselines(model, tool)
			if err != nil {
				return err
			}

			out, err := formatBaselines(baselines, format)
			if err != nil {
				return err
			}
			fmt.Print(out)
			return nil
		},
	}

	cmd.Flags().StringVarP(&cfgPath, "config", "c", config.DefaultConfigPath(), "config file path")
	cmd.Flags().StringVar(&model, "model", "", "filter by model")
	cmd.Flags().StringVar(&tool, "tool", "", "filter by tool")
	cmd.Flags().StringVarP(&format, "format", "f", "md", "output format (md|json)")
	return cmd
}

func NewRecomputeCmd() *cobra.Command {
	var cfgPath string

	cmd := &cobra.Command{
		Use:   "recompute",
		Short: "Recompute baselines from span metrics",
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

			retentionDays := 90
			if cfg.Baseline.RetentionDays > 0 {
				retentionDays = cfg.Baseline.RetentionDays
			}
			cutoff := currentTimeMs() - int64(retentionDays)*24*60*60*1000

			if err := store.RecomputeBaselines(cutoff); err != nil {
				return err
			}
			fmt.Println("Baselines recomputed successfully")
			return nil
		},
	}

	cmd.Flags().StringVarP(&cfgPath, "config", "c", config.DefaultConfigPath(), "config file path")
	return cmd
}

func NewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "baseline",
		Short: "Manage baselines",
	}
	cmd.AddCommand(NewShowCmd())
	cmd.AddCommand(NewRecomputeCmd())
	return cmd
}

func formatBaselines(baselines []db.BaselineStats, format string) (string, error) {
	if len(baselines) == 0 {
		if format == "json" {
			return "[]", nil
		}
		return "No baselines found.\n", nil
	}

	if format == "json" {
		return output.FormatJSON(baselines)
	}

	header := []string{"Model", "Tool", "Metric", "Mean", "P95", "Stddev", "Count"}
	rows := make([][]string, 0, len(baselines))
	for _, b := range baselines {
		rows = append(rows, []string{
			b.Model, b.Tool, b.Metric,
			output.Fmtf(b.Mean, 2), output.Fmtf(b.P95, 2),
			output.Fmtf(b.Stddev, 2), fmt.Sprintf("%d", b.SampleCount),
		})
	}
	return output.FormatTable(header, rows), nil
}

func currentTimeMs() int64 {
	return db.CurrentTimeMs()
}
