package rootcause

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"

	"github.com/spf13/cobra"
)

type spanRecord struct {
	TraceID           string                 `json:"traceId"`
	SpanID            string                 `json:"spanId"`
	ParentSpanID      string                 `json:"parentSpanId,omitempty"`
	Name              string                 `json:"name"`
	StartTimeUnixNano int64                  `json:"startTimeUnixNano"`
	EndTimeUnixNano   int64                  `json:"endTimeUnixNano"`
	Attributes        map[string]interface{} `json:"attributes,omitempty"`
	Status            *spanStatus            `json:"status,omitempty"`
}

type spanStatus struct {
	Code    int    `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type RootCauseResult struct {
	TraceID      string       `json:"trace_id"`
	TriggerSpan  *TriggerSpan `json:"trigger_span,omitempty"`
	CascadeSpans []CascadeRef `json:"cascade_spans"`
	TokenWaste   int          `json:"token_waste"`
}

type TriggerSpan struct {
	SpanID string `json:"span_id"`
	Name   string `json:"name"`
	Error  string `json:"error"`
}

type CascadeRef struct {
	SpanID string `json:"span_id"`
	Name   string `json:"name"`
}

func NewCmd() *cobra.Command {
	var (
		filePath string
	)

	cmd := &cobra.Command{
		Use:   "root-cause [trace-id]",
		Short: "Analyze a trace to find the root-cause error and cascading failures",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			traceID := args[0]
			if filePath == "" {
				return fmt.Errorf("--file is required for root-cause analysis")
			}

			spans, err := loadSpansFromFile(filePath, traceID)
			if err != nil {
				return fmt.Errorf("reading trace file: %w", err)
			}

			if len(spans) == 0 {
				return fmt.Errorf("no spans found for trace %s", traceID)
			}

			result := analyzeTrace(traceID, spans)
			fmt.Print(formatResult(result))

			if result.TriggerSpan != nil {
				return fmt.Errorf("root cause identified")
			}
			return nil
		},
	}

	cmd.Flags().StringVar(&filePath, "file", "", "JSONL file containing trace spans")
	return cmd
}

func loadSpansFromFile(filePath, traceID string) ([]spanRecord, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var spans []spanRecord
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var span spanRecord
		if err := json.Unmarshal(line, &span); err != nil {
			continue
		}
		if span.TraceID == traceID {
			spans = append(spans, span)
		}
	}

	return spans, scanner.Err()
}

func analyzeTrace(traceID string, spans []spanRecord) *RootCauseResult {
	sort.Slice(spans, func(i, j int) bool {
		return spans[i].StartTimeUnixNano < spans[j].StartTimeUnixNano
	})

	result := &RootCauseResult{
		TraceID:      traceID,
		CascadeSpans: []CascadeRef{},
	}

	foundTrigger := false
	for _, span := range spans {
		if !foundTrigger && isErrorSpan(span) {
			result.TriggerSpan = &TriggerSpan{
				SpanID: span.SpanID,
				Name:   span.Name,
				Error:  getErrorMessage(span),
			}
			foundTrigger = true
			continue
		}
		if foundTrigger {
			if isErrorSpan(span) {
				result.CascadeSpans = append(result.CascadeSpans, CascadeRef{
					SpanID: span.SpanID,
					Name:   span.Name,
				})
			}
			result.TokenWaste += getTokens(span)
		}
	}

	return result
}

func isErrorSpan(span spanRecord) bool {
	if span.Status != nil && span.Status.Code == 2 {
		return true
	}
	if span.Attributes != nil {
		if _, ok := span.Attributes["error"]; ok {
			return true
		}
		if v, ok := span.Attributes["otel.status_code"]; ok && v == "ERROR" {
			return true
		}
	}
	return false
}

func getErrorMessage(span spanRecord) string {
	if span.Status != nil && span.Status.Message != "" {
		return span.Status.Message
	}
	if span.Attributes != nil {
		if msg, ok := span.Attributes["error.message"].(string); ok {
			return msg
		}
		if msg, ok := span.Attributes["exception.message"].(string); ok {
			return msg
		}
	}
	return "Unknown error"
}

func getTokens(span spanRecord) int {
	if span.Attributes == nil {
		return 0
	}
	input := toInt(span.Attributes["gen_ai.usage.input_tokens"])
	output := toInt(span.Attributes["gen_ai.usage.output_tokens"])
	return input + output
}

func toInt(v interface{}) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}

func formatResult(result *RootCauseResult) string {
	s := fmt.Sprintf("Trace: %s\n\n", result.TraceID)

	if result.TriggerSpan == nil {
		s += "No error spans found in trace.\n"
		return s
	}

	s += fmt.Sprintf("Trigger: [%s] %s\n", result.TriggerSpan.SpanID, result.TriggerSpan.Name)
	s += fmt.Sprintf("  Error: %s\n\n", result.TriggerSpan.Error)
	s += fmt.Sprintf("Cascade spans: %d\n", len(result.CascadeSpans))
	for _, c := range result.CascadeSpans {
		s += fmt.Sprintf("  - [%s] %s\n", c.SpanID, c.Name)
	}
	s += fmt.Sprintf("\nToken waste after trigger: %d\n", result.TokenWaste)
	return s
}
