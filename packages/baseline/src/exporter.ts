import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import { GenAIAttributes, HoAttributes } from "@ho/sdk";
import { BaselineStore } from "./store.js";
import type { BaselineStoreConfig, MetricEntry } from "./types.js";

function getStringAttr(span: ReadableSpan, key: string): string {
	const val = span.attributes[key];
	return typeof val === "string" ? val : "";
}

function getNumberAttr(span: ReadableSpan, key: string): number {
	const val = span.attributes[key];
	return typeof val === "number" ? val : 0;
}

function extractMetricEntry(span: ReadableSpan): MetricEntry {
	const startMs = span.startTime[0] * 1000 + span.startTime[1] / 1_000_000;
	const endMs = span.endTime[0] * 1000 + span.endTime[1] / 1_000_000;
	const latencyMs = endMs - startMs;

	const model = getStringAttr(span, GenAIAttributes.REQUEST_MODEL);
	const tool = getStringAttr(span, GenAIAttributes.TOOL_NAME);
	const inputTokens = getNumberAttr(span, GenAIAttributes.USAGE_INPUT_TOKENS);
	const outputTokens = getNumberAttr(span, GenAIAttributes.USAGE_OUTPUT_TOKENS);
	const costUsd = getNumberAttr(span, HoAttributes.COST_USD);
	const errorCategory = getStringAttr(span, HoAttributes.ERROR_CATEGORY) || undefined;
	const harnessVersion = getStringAttr(span, HoAttributes.HARNESS_VERSION) || undefined;
	const traceId = span.spanContext().traceId;

	return {
		timestamp: Math.round(startMs),
		traceId,
		model,
		tool,
		errorCategory,
		latencyMs,
		inputTokens,
		outputTokens,
		costUsd,
		harnessVersion,
	};
}

export class BaselineExporter implements SpanExporter {
	private readonly store: BaselineStore;

	constructor(config: BaselineStoreConfig) {
		this.store = new BaselineStore(config);
	}

	export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
		try {
			for (const span of spans) {
				const entry = extractMetricEntry(span);
				this.store.recordMetric(entry);
			}
			resultCallback({ code: ExportResultCode.SUCCESS });
		} catch {
			resultCallback({ code: ExportResultCode.FAILED });
		}
	}

	getStore(): BaselineStore {
		return this.store;
	}

	async shutdown(): Promise<void> {
		this.store.close();
	}

	async forceFlush(): Promise<void> {
		// no-op for synchronous SQLite store
	}
}
