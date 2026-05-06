import { SpanStatusCode } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";
import { EnrichingExporter } from "../src/enriching-exporter.js";
import type { SpanEnricher } from "../src/types.js";

function createMockSpan(attrs: Attributes = {}): ReadableSpan {
	return {
		name: "test-span",
		kind: 0,
		parentSpanId: undefined,
		startTime: [0, 0] as [number, number],
		endTime: [1, 0] as [number, number],
		duration: [1, 0] as [number, number],
		status: { code: SpanStatusCode.OK },
		attributes: attrs,
		links: [],
		events: [],
		ended: true,
		resource: { attributes: {} } as any,
		instrumentationLibrary: { name: "test", version: "1.0" },
		droppedAttributesCount: 0,
		droppedEventsCount: 0,
		droppedLinksCount: 0,
		spanContext: () => ({
			traceId: "abcd1234abcd1234abcd1234abcd1234",
			spanId: "abcd1234abcd1234",
			traceFlags: 1,
		}),
	} as ReadableSpan;
}

describe("EnrichingExporter", () => {
	it("passes enriched spans to inner exporter", () => {
		const exported: ReadableSpan[] = [];
		const inner: SpanExporter = {
			export(spans, cb) {
				exported.push(...spans);
				cb({ code: ExportResultCode.SUCCESS });
			},
			shutdown: () => Promise.resolve(),
		};

		const enricher: SpanEnricher = {
			enrich(_span, attrs) {
				return { ...attrs, "ho.enriched": true };
			},
		};

		const exporter = new EnrichingExporter(inner, [enricher]);
		const span = createMockSpan({ "gen_ai.request.model": "gpt-4" });

		exporter.export([span], () => {});

		expect(exported).toHaveLength(1);
		expect(exported[0].attributes["ho.enriched"]).toBe(true);
		expect(exported[0].attributes["gen_ai.request.model"]).toBe("gpt-4");
	});

	it("chains multiple enrichers in order", () => {
		const exported: ReadableSpan[] = [];
		const inner: SpanExporter = {
			export(spans, cb) {
				exported.push(...spans);
				cb({ code: ExportResultCode.SUCCESS });
			},
			shutdown: () => Promise.resolve(),
		};

		const enricher1: SpanEnricher = {
			enrich(_span, attrs) {
				return { ...attrs, step: 1 };
			},
		};
		const enricher2: SpanEnricher = {
			enrich(_span, attrs) {
				return { ...attrs, step: (attrs.step as number) + 1 };
			},
		};

		const exporter = new EnrichingExporter(inner, [enricher1, enricher2]);
		exporter.export([createMockSpan()], () => {});

		expect(exported[0].attributes.step).toBe(2);
	});

	it("isolates enricher exceptions — skips failing enricher", () => {
		const exported: ReadableSpan[] = [];
		const inner: SpanExporter = {
			export(spans, cb) {
				exported.push(...spans);
				cb({ code: ExportResultCode.SUCCESS });
			},
			shutdown: () => Promise.resolve(),
		};

		const failingEnricher: SpanEnricher = {
			enrich() {
				throw new Error("enricher crash");
			},
		};
		const safeEnricher: SpanEnricher = {
			enrich(_span, attrs) {
				return { ...attrs, "ho.safe": true };
			},
		};

		const exporter = new EnrichingExporter(inner, [failingEnricher, safeEnricher]);
		exporter.export([createMockSpan({ original: "value" })], () => {});

		expect(exported[0].attributes.original).toBe("value");
		expect(exported[0].attributes["ho.safe"]).toBe(true);
	});

	it("wrapper delegates spanContext() correctly", () => {
		const exported: ReadableSpan[] = [];
		const inner: SpanExporter = {
			export(spans, cb) {
				exported.push(...spans);
				cb({ code: ExportResultCode.SUCCESS });
			},
			shutdown: () => Promise.resolve(),
		};

		const enricher: SpanEnricher = {
			enrich(_span, attrs) {
				return { ...attrs, added: true };
			},
		};

		const exporter = new EnrichingExporter(inner, [enricher]);
		exporter.export([createMockSpan()], () => {});

		const wrapped = exported[0];
		expect(wrapped.spanContext().traceId).toBe("abcd1234abcd1234abcd1234abcd1234");
		expect(wrapped.name).toBe("test-span");
	});
});
