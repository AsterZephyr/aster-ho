import { SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../src/rules.js";
import { TailSamplingExporter } from "../src/tail-sampler.js";
import type { TailSamplerConfig } from "../src/types.js";

function mockSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
	return {
		name: "test-span",
		kind: 0,
		spanContext: () => ({
			traceId: "aaaa0000bbbb1111cccc2222dddd3333",
			spanId: "1234567890abcdef",
			traceFlags: 1,
		}),
		parentSpanId: undefined,
		startTime: [1700000000, 0],
		endTime: [1700000001, 0],
		status: { code: SpanStatusCode.OK },
		attributes: {},
		resource: { attributes: {} } as any,
		instrumentationLibrary: { name: "test" },
		links: [],
		events: [],
		duration: [1, 0],
		ended: true,
		droppedAttributesCount: 0,
		droppedEventsCount: 0,
		droppedLinksCount: 0,
		...overrides,
	} as unknown as ReadableSpan;
}

describe("evaluateRules", () => {
	it("keeps error spans with always_keep rule", () => {
		const span = mockSpan({ status: { code: SpanStatusCode.ERROR, message: "fail" } });
		const rules = [
			{
				name: "keep-errors",
				decision: "always_keep" as const,
				condition: { type: "status_error" as const },
			},
		];
		expect(evaluateRules(span, rules, 0.0)).toBe(true);
	});

	it("drops non-error spans with always_drop for errors, low default rate", () => {
		const span = mockSpan();
		const rules = [
			{
				name: "keep-errors",
				decision: "always_keep" as const,
				condition: { type: "status_error" as const },
			},
		];
		expect(evaluateRules(span, rules, 0.0)).toBe(false);
	});

	it("keeps spans with matching attribute_exists", () => {
		const span = mockSpan({ attributes: { "ho.context_rot.type": "token_bloat" } } as any);
		const rules = [
			{
				name: "keep-rot",
				decision: "always_keep" as const,
				condition: { type: "attribute_exists" as const, key: "ho.context_rot.type" },
			},
		];
		expect(evaluateRules(span, rules, 0.0)).toBe(true);
	});

	it("applies attribute_equals condition", () => {
		const span = mockSpan({ attributes: { "gen_ai.request.model": "gpt-4" } } as any);
		const rules = [
			{
				name: "drop-gpt4",
				decision: "always_drop" as const,
				condition: {
					type: "attribute_equals" as const,
					key: "gen_ai.request.model",
					value: "gpt-4",
				},
			},
		];
		expect(evaluateRules(span, rules, 1.0)).toBe(false);
	});

	it("applies attribute_gt condition", () => {
		const span = mockSpan({ attributes: { "gen_ai.usage.input_tokens": 5000 } } as any);
		const rules = [
			{
				name: "keep-large",
				decision: "always_keep" as const,
				condition: { type: "attribute_gt" as const, key: "gen_ai.usage.input_tokens", value: 1000 },
			},
		];
		expect(evaluateRules(span, rules, 0.0)).toBe(true);
	});

	it("uses default rate when no rules match", () => {
		const span = mockSpan();
		const rules = [
			{
				name: "keep-errors",
				decision: "always_keep" as const,
				condition: { type: "status_error" as const },
			},
		];
		expect(evaluateRules(span, rules, 1.0)).toBe(true);
	});

	it("deterministic sampling via trace-id hash", () => {
		const span = mockSpan();
		const rules: [] = [];
		const result1 = evaluateRules(span, rules, 0.5);
		const result2 = evaluateRules(span, rules, 0.5);
		expect(result1).toBe(result2);
	});
});

describe("TailSamplingExporter", () => {
	it("filters spans and delegates to inner exporter", () => {
		const exported: ReadableSpan[] = [];
		const inner: SpanExporter = {
			export(spans, cb) {
				exported.push(...spans);
				cb({ code: ExportResultCode.SUCCESS });
			},
			shutdown: async () => {},
		};

		const config: TailSamplerConfig = {
			defaultRate: 0.0,
			rules: [
				{ name: "keep-errors", decision: "always_keep", condition: { type: "status_error" } },
			],
		};

		const sampler = new TailSamplingExporter(inner, config);
		const spans = [
			mockSpan({ status: { code: SpanStatusCode.ERROR, message: "err" } }),
			mockSpan(),
			mockSpan(),
		];

		sampler.export(spans, () => {});
		expect(exported).toHaveLength(1);
		expect(exported[0].status.code).toBe(SpanStatusCode.ERROR);
	});

	it("returns SUCCESS when all spans are dropped", () => {
		const inner: SpanExporter = {
			export: () => {},
			shutdown: async () => {},
		};

		const config: TailSamplerConfig = { defaultRate: 0.0, rules: [] };
		const sampler = new TailSamplingExporter(inner, config);

		let result = -1;
		sampler.export([mockSpan()], (r) => {
			result = r.code;
		});
		expect(result).toBe(ExportResultCode.SUCCESS);
	});

	it("passes all spans at rate 1.0", () => {
		const exported: ReadableSpan[] = [];
		const inner: SpanExporter = {
			export(spans, cb) {
				exported.push(...spans);
				cb({ code: ExportResultCode.SUCCESS });
			},
			shutdown: async () => {},
		};

		const config: TailSamplerConfig = { defaultRate: 1.0, rules: [] };
		const sampler = new TailSamplingExporter(inner, config);

		const spans = [mockSpan(), mockSpan(), mockSpan()];
		sampler.export(spans, () => {});
		expect(exported).toHaveLength(3);
	});
});
