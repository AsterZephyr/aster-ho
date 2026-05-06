package db

import (
	"math"
	"testing"
)

func TestComputeStats(t *testing.T) {
	values := []float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	s := computeStats(values)

	if math.Abs(s.Mean-5.5) > 0.001 {
		t.Errorf("mean: got %f, want 5.5", s.Mean)
	}
	if s.P50 < 5 || s.P50 > 6 {
		t.Errorf("p50: got %f, want ~5.5", s.P50)
	}
	if s.P95 < 9 {
		t.Errorf("p95: got %f, want >= 9", s.P95)
	}
	if s.Stddev < 2.8 || s.Stddev > 2.9 {
		t.Errorf("stddev: got %f, want ~2.87", s.Stddev)
	}
}

func TestComputeStatsEmpty(t *testing.T) {
	s := computeStats(nil)
	if s.Mean != 0 || s.Stddev != 0 {
		t.Errorf("empty stats: got %+v, want zeros", s)
	}
}

func TestPercentile(t *testing.T) {
	sorted := []float64{1, 2, 3, 4, 5}
	p50 := percentile(sorted, 50)
	if p50 != 3 {
		t.Errorf("p50: got %f, want 3", p50)
	}
	p0 := percentile(sorted, 0)
	if p0 != 1 {
		t.Errorf("p0: got %f, want 1", p0)
	}
	p100 := percentile(sorted, 100)
	if p100 != 5 {
		t.Errorf("p100: got %f, want 5", p100)
	}
}
