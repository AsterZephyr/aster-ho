import type { Attributes } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ReadableSpanWrapper } from "./readable-span-wrapper.js";
import type { SpanEnricher } from "./types.js";

export class EnrichingExporter implements SpanExporter {
	private readonly inner: SpanExporter;
	private readonly enrichers: SpanEnricher[];

	constructor(inner: SpanExporter, enrichers: SpanEnricher[]) {
		this.inner = inner;
		this.enrichers = enrichers;
	}

	export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
		const enriched = spans.map((span) => this.enrichSpan(span));
		this.inner.export(enriched, resultCallback);
	}

	async shutdown(): Promise<void> {
		return this.inner.shutdown();
	}

	forceFlush?(): Promise<void> {
		return this.inner.forceFlush?.() ?? Promise.resolve();
	}

	private enrichSpan(span: ReadableSpan): ReadableSpan {
		let attrs: Attributes = { ...span.attributes };
		for (const enricher of this.enrichers) {
			try {
				attrs = enricher.enrich(span, attrs);
			} catch {
				// Enricher exception isolation: skip and continue
			}
		}
		return new ReadableSpanWrapper(span, attrs);
	}
}
