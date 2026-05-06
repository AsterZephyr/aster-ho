package output

import (
	"encoding/json"
	"fmt"
	"strings"
)

func FormatJSON(v any) (string, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal json: %w", err)
	}
	return string(data), nil
}

func FormatTable(header []string, rows [][]string) string {
	var sb strings.Builder
	sep := make([]string, len(header))
	for i := range sep {
		sep[i] = "------"
	}

	sb.WriteString("| " + strings.Join(header, " | ") + " |\n")
	sb.WriteString("| " + strings.Join(sep, " | ") + " |\n")
	for _, row := range rows {
		sb.WriteString("| " + strings.Join(row, " | ") + " |\n")
	}
	return sb.String()
}

func Fmtf(f float64, prec int) string {
	return fmt.Sprintf("%.*f", prec, f)
}
