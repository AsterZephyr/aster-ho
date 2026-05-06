package main

import (
	"fmt"
	"os"

	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/baseline"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/compare"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/report"
	"github.com/AsterZephyr/aster-ho/cmd/ho/internal/rootcause"
	"github.com/spf13/cobra"
)

var version = "dev"

func main() {
	root := &cobra.Command{
		Use:     "ho",
		Short:   "ho CLI — observability toolkit for AI agents",
		Version: version,
	}

	root.AddCommand(baseline.NewCmd())
	root.AddCommand(compare.NewCmd())
	root.AddCommand(report.NewCmd())
	root.AddCommand(rootcause.NewCmd())

	if err := root.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
