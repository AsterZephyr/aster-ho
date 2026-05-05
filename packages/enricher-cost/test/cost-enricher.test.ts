import { describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { CostEnricher } from "../src/index.js";

function mockSpan(attrs: Record<string, unknown>): ReadableSpan {
	return {
		attributes: attrs,
		status: { code: SpanStatusCode.OK },
	} as unknown as ReadableSpan;
}

describe("CostEnricher", () => {
	const enricher = new CostEnricher();

	it("calculates cost for a basic GPT-4o call", () => {
		const span = mockSpan({
			"gen_ai.request.model": "gpt-4o",
			"gen_ai.usage.input_tokens": 1000,
			"gen_ai.usage.output_tokens": 500,
		});

		const result = enricher.enrich(span, { ...span.attributes });
		// 1000 * 2.5e-6 + 500 * 10e-6 = 0.0025 + 0.005 = 0.0075
		expect(result["ho.cost.usd"]).toBeCloseTo(0.0075);
	});

	it("uses response model over request model", () => {
		const span = mockSpan({
			"gen_ai.request.model": "gpt-4o",
			"gen_ai.response.model": "gpt-4o-mini",
			"gen_ai.usage.input_tokens": 1000,
			"gen_ai.usage.output_tokens": 0,
		});

		const result = enricher.enrich(span, { ...span.attributes });
		// gpt-4o-mini: 1000 * 0.15e-6 = 0.00015
		expect(result["ho.cost.usd"]).toBeCloseTo(0.00015);
	});

	it("accounts for cache read tokens", () => {
		const span = mockSpan({
			"gen_ai.request.model": "gpt-4o",
			"gen_ai.usage.input_tokens": 1000,
			"gen_ai.usage.output_tokens": 0,
			"gen_ai.usage.cache_read.input_tokens": 800,
		});

		const result = enricher.enrich(span, { ...span.attributes });
		// (1000 - 800) * 2.5e-6 + 800 * (2.5e-6 * 0.1)
		// = 200 * 2.5e-6 + 800 * 0.25e-6
		// = 0.0005 + 0.0002 = 0.0007
		expect(result["ho.cost.usd"]).toBeCloseTo(0.0007);
	});

	it("does prefix matching for versioned model names", () => {
		const span = mockSpan({
			"gen_ai.request.model": "gpt-4o-2024-11-20",
			"gen_ai.usage.input_tokens": 100,
			"gen_ai.usage.output_tokens": 50,
		});

		const result = enricher.enrich(span, { ...span.attributes });
		expect(result["ho.cost.usd"]).toBeDefined();
		// Should match gpt-4o pricing
		expect(result["ho.cost.usd"]).toBeCloseTo(100 * 2.5e-6 + 50 * 10e-6);
	});

	it("skips when no token usage present", () => {
		const span = mockSpan({ "gen_ai.request.model": "gpt-4o" });
		const attrs = { ...span.attributes };
		const result = enricher.enrich(span, attrs);
		expect(result["ho.cost.usd"]).toBeUndefined();
	});

	it("skips when model is unknown", () => {
		const span = mockSpan({
			"gen_ai.request.model": "unknown-model-xyz",
			"gen_ai.usage.input_tokens": 100,
			"gen_ai.usage.output_tokens": 50,
		});

		const result = enricher.enrich(span, { ...span.attributes });
		expect(result["ho.cost.usd"]).toBeUndefined();
	});

	it("accepts custom pricing table", () => {
		const custom = new CostEnricher({
			pricing: { "my-model": { inputPerToken: 1e-6, outputPerToken: 2e-6 } },
		});

		const span = mockSpan({
			"gen_ai.request.model": "my-model",
			"gen_ai.usage.input_tokens": 100,
			"gen_ai.usage.output_tokens": 50,
		});

		const result = custom.enrich(span, { ...span.attributes });
		expect(result["ho.cost.usd"]).toBeCloseTo(100 * 1e-6 + 50 * 2e-6);
	});
});
