import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { evaluateRules } from "./rules.js";
import type { TailSamplerConfig } from "./types.js";

export class TailSamplingExporter implements SpanExporter {
	private readonly inner: SpanExporter;
	private readonly config: TailSamplerConfig;

	constructor(inner: SpanExporter, config: TailSamplerConfig) {
		this.inner = inner;
		this.config = config;
	}

	export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
		const sampled = spans.filter((span) =>
			evaluateRules(span, this.config.rules, this.config.defaultRate),
		);

		if (sampled.length === 0) {
			resultCallback({ code: ExportResultCode.SUCCESS });
			return;
		}

		this.inner.export(sampled, resultCallback);
	}

	async shutdown(): Promise<void> {
		return this.inner.shutdown();
	}

	async forceFlush(): Promise<void> {
		if (this.inner.forceFlush) {
			return this.inner.forceFlush();
		}
	}
}
