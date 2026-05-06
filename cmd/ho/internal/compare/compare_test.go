package compare

import "testing"

func TestParseTimeWindow(t *testing.T) {
	tests := []struct {
		input string
		want  int64
		err   bool
	}{
		{"7d", 7 * 24 * 60 * 60 * 1000, false},
		{"24h", 24 * 60 * 60 * 1000, false},
		{"30m", 30 * 60 * 1000, false},
		{"1d", 24 * 60 * 60 * 1000, false},
		{"invalid", 0, true},
		{"", 0, true},
		{"5x", 0, true},
	}

	for _, tt := range tests {
		got, err := ParseTimeWindow(tt.input)
		if tt.err {
			if err == nil {
				t.Errorf("ParseTimeWindow(%q): expected error", tt.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseTimeWindow(%q): unexpected error: %v", tt.input, err)
			continue
		}
		if got != tt.want {
			t.Errorf("ParseTimeWindow(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

func TestComputeDiff(t *testing.T) {
	d := computeDiff(100, 120)
	if d.Delta != 20 {
		t.Errorf("delta: got %f, want 20", d.Delta)
	}
	if d.DeltaPercent != 20 {
		t.Errorf("delta%%: got %f, want 20", d.DeltaPercent)
	}

	d = computeDiff(0, 0)
	if d.DeltaPercent != 0 {
		t.Errorf("0/0 delta%%: got %f, want 0", d.DeltaPercent)
	}

	d = computeDiff(0, 5)
	if d.DeltaPercent != 100 {
		t.Errorf("0/5 delta%%: got %f, want 100", d.DeltaPercent)
	}
}
