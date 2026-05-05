import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { MetricDefinition, MetricSample } from "./types.js";

export function convertSpans(
	spans: ReadableSpan[],
	metrics: readonly MetricDefinition[],
	dimensions: readonly string[],
): MetricSample[] {
	const samples: MetricSample[] = [];

	for (const span of spans) {
		const labels = extractLabels(span, dimensions);

		for (const metric of metrics) {
			if (metric.filter && !matchesFilter(span, metric.filter)) continue;

			const value = extractValue(span, metric.source);
			if (value === undefined) continue;

			const sampleLabels = metric.source === "context_rot_count"
				? { ...labels, rot_type: String(span.attributes["ho.context_rot.type"]) }
				: labels;

			samples.push({ name: metric.name, type: metric.type, value, labels: sampleLabels });
		}
	}

	return samples;
}

function extractLabels(span: ReadableSpan, dimensions: readonly string[]): Record<string, string> {
	const labels: Record<string, string> = {};
	for (const dim of dimensions) {
		const val = span.attributes[dim];
		if (val !== undefined) {
			labels[dim.replace(/\./g, "_")] = String(val);
		}
	}
	return labels;
}

function extractValue(span: ReadableSpan, source: string): number | undefined {
	switch (source) {
		case "span_duration": {
			const [ss, sn] = span.startTime;
			const [es, en] = span.endTime;
			return (es - ss) + (en - sn) / 1_000_000_000;
		}
		case "input_tokens":
			return typeof span.attributes["gen_ai.usage.input_tokens"] === "number"
				? span.attributes["gen_ai.usage.input_tokens"] as number
				: undefined;
		case "output_tokens":
			return typeof span.attributes["gen_ai.usage.output_tokens"] === "number"
				? span.attributes["gen_ai.usage.output_tokens"] as number
				: undefined;
		case "cost":
			return typeof span.attributes["ho.cost.usd"] === "number"
				? span.attributes["ho.cost.usd"] as number
				: undefined;
		case "error_count":
			return span.status.code === SpanStatusCode.ERROR ? 1 : 0;
		case "span_count":
			return 1;
		case "context_rot_count":
			return span.attributes["ho.context_rot.type"] !== undefined ? 1 : undefined;
		default:
			return undefined;
	}
}

function matchesFilter(span: ReadableSpan, filter: Readonly<Record<string, string>>): boolean {
	for (const [key, value] of Object.entries(filter)) {
		if (String(span.attributes[key] ?? "") !== value) return false;
	}
	return true;
}
