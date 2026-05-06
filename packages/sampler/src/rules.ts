import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { SamplingCondition, SamplingRule } from "./types.js";

export function evaluateRules(
	span: ReadableSpan,
	rules: readonly SamplingRule[],
	defaultRate: number,
): boolean {
	for (const rule of rules) {
		if (matchesCondition(span, rule.condition)) {
			return shouldKeep(span, rule);
		}
	}
	return hashSample(span.spanContext().traceId, defaultRate);
}

function matchesCondition(span: ReadableSpan, condition: SamplingCondition): boolean {
	switch (condition.type) {
		case "status_error":
			return span.status.code === SpanStatusCode.ERROR;
		case "attribute_exists":
			return span.attributes[condition.key] !== undefined;
		case "attribute_equals":
			return span.attributes[condition.key] === condition.value;
		case "attribute_gt": {
			const v = span.attributes[condition.key];
			return typeof v === "number" && v > condition.value;
		}
		default:
			return false;
	}
}

function shouldKeep(span: ReadableSpan, rule: SamplingRule): boolean {
	switch (rule.decision) {
		case "always_keep":
			return true;
		case "always_drop":
			return false;
		case "probabilistic":
			return hashSample(span.spanContext().traceId, rule.rate ?? 1.0);
	}
}

function hashSample(traceId: string, rate: number): boolean {
	if (rate >= 1.0) return true;
	if (rate <= 0.0) return false;
	let hash = 0;
	for (let i = 0; i < traceId.length; i++) {
		hash = (hash * 31 + traceId.charCodeAt(i)) | 0;
	}
	const normalized = (hash >>> 0) / 0xffffffff;
	return normalized < rate;
}
