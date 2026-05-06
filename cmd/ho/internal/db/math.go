package db

import (
	"math"
	"sort"
	"time"
)

type stats struct {
	Mean   float64
	Stddev float64
	P50    float64
	P95    float64
	P99    float64
}

func computeStats(values []float64) stats {
	n := len(values)
	if n == 0 {
		return stats{}
	}

	sorted := make([]float64, n)
	copy(sorted, values)
	sort.Float64s(sorted)

	sum := 0.0
	for _, v := range sorted {
		sum += v
	}
	mean := sum / float64(n)

	variance := 0.0
	for _, v := range sorted {
		d := v - mean
		variance += d * d
	}
	variance /= float64(n)
	stddev := math.Sqrt(variance)

	return stats{
		Mean:   mean,
		Stddev: stddev,
		P50:    percentile(sorted, 50),
		P95:    percentile(sorted, 95),
		P99:    percentile(sorted, 99),
	}
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := (p / 100) * float64(len(sorted)-1)
	lower := int(math.Floor(index))
	upper := int(math.Ceil(index))
	if lower == upper {
		return sorted[lower]
	}
	weight := index - float64(lower)
	return sorted[lower]*(1-weight) + sorted[upper]*weight
}

func currentTimeMs() int64 {
	return time.Now().UnixMilli()
}

func CurrentTimeMs() int64 {
	return time.Now().UnixMilli()
}
