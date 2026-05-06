package rootcause

import "testing"

func TestAnalyzeTraceNoErrors(t *testing.T) {
	spans := []spanRecord{
		{TraceID: "t1", SpanID: "s1", Name: "chat", StartTimeUnixNano: 1000},
		{TraceID: "t1", SpanID: "s2", Name: "tool", StartTimeUnixNano: 2000},
	}
	result := analyzeTrace("t1", spans)
	if result.TriggerSpan != nil {
		t.Error("expected no trigger span")
	}
	if result.TokenWaste != 0 {
		t.Errorf("token waste: got %d, want 0", result.TokenWaste)
	}
}

func TestAnalyzeTraceWithError(t *testing.T) {
	spans := []spanRecord{
		{TraceID: "t1", SpanID: "s1", Name: "chat", StartTimeUnixNano: 1000},
		{TraceID: "t1", SpanID: "s2", Name: "tool/search", StartTimeUnixNano: 2000,
			Status: &spanStatus{Code: 2, Message: "timeout"},
		},
		{TraceID: "t1", SpanID: "s3", Name: "retry", StartTimeUnixNano: 3000,
			Attributes: map[string]interface{}{
				"gen_ai.usage.input_tokens":  float64(500),
				"gen_ai.usage.output_tokens": float64(200),
			},
		},
		{TraceID: "t1", SpanID: "s4", Name: "retry-2", StartTimeUnixNano: 4000,
			Status:     &spanStatus{Code: 2, Message: "timeout again"},
			Attributes: map[string]interface{}{"gen_ai.usage.input_tokens": float64(300)},
		},
	}

	result := analyzeTrace("t1", spans)
	if result.TriggerSpan == nil {
		t.Fatal("expected trigger span")
	}
	if result.TriggerSpan.SpanID != "s2" {
		t.Errorf("trigger: got %s, want s2", result.TriggerSpan.SpanID)
	}
	if result.TriggerSpan.Error != "timeout" {
		t.Errorf("error: got %q, want timeout", result.TriggerSpan.Error)
	}
	if len(result.CascadeSpans) != 1 {
		t.Errorf("cascade: got %d, want 1", len(result.CascadeSpans))
	}
	if result.TokenWaste != 1000 {
		t.Errorf("token waste: got %d, want 1000", result.TokenWaste)
	}
}

func TestIsErrorSpan(t *testing.T) {
	tests := []struct {
		name string
		span spanRecord
		want bool
	}{
		{"status code 2", spanRecord{Status: &spanStatus{Code: 2}}, true},
		{"status code 1", spanRecord{Status: &spanStatus{Code: 1}}, false},
		{"error attribute", spanRecord{Attributes: map[string]interface{}{"error": "something"}}, true},
		{"otel status ERROR", spanRecord{Attributes: map[string]interface{}{"otel.status_code": "ERROR"}}, true},
		{"no error", spanRecord{}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isErrorSpan(tt.span)
			if got != tt.want {
				t.Errorf("isErrorSpan: got %v, want %v", got, tt.want)
			}
		})
	}
}
