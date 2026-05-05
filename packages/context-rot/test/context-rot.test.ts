import { describe, expect, it, vi } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { Attributes, SpanContext } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ContextRotEnricher } from "../src/enricher.js";

function mockSpan(opts: {
	traceId: string;
	spanId: string;
	status?: SpanStatusCode;
	attrs?: Record<string, unknown>;
}): ReadableSpan {
	return {
		spanContext(): SpanContext {
			return {
				traceId: opts.traceId,
				spanId: opts.spanId,
				traceFlags: 1,
			};
		},
		status: { code: opts.status ?? SpanStatusCode.OK },
		attributes: opts.attrs ?? {},
	} as unknown as ReadableSpan;
}

describe("ContextRotEnricher", () => {
	it("detects token bloat when ratio exceeds threshold", () => {
		const enricher = new ContextRotEnricher();
		const traceId = "aaaa000000000000aaaa000000000000";

		// First span establishes baseline
		const span1 = mockSpan({ traceId, spanId: "span1111", attrs: {} });
		const attrs1: Attributes = { "gen_ai.usage.input_tokens": 500 };
		const result1 = enricher.enrich(span1, attrs1);
		expect(result1["ho.context_rot.type"]).toBeUndefined();

		// Second span with 2.5x tokens triggers bloat
		const span2 = mockSpan({ traceId, spanId: "span2222", attrs: {} });
		const attrs2: Attributes = { "gen_ai.usage.input_tokens": 1250 };
		const result2 = enricher.enrich(span2, attrs2);
		expect(result2["ho.context_rot.type"]).toBe("token_bloat");
		expect(result2["ho.context_rot.trigger_span_id"]).toBe("span2222");
		expect(result2["ho.context_rot.token_growth_ratio"]).toBe(2.5);
	});

	it("detects error cascade after multiple consecutive errors", () => {
		const enricher = new ContextRotEnricher();
		const traceId = "bbbb000000000000bbbb000000000000";

		// First error establishes the anchor
		const span1 = mockSpan({ traceId, spanId: "err1", status: SpanStatusCode.ERROR });
		const result1 = enricher.enrich(span1, {});
		expect(result1["ho.context_rot.type"]).toBeUndefined();

		// Second error increments count but doesn't trigger yet (need >= 2 after first)
		const span2 = mockSpan({ traceId, spanId: "err2", status: SpanStatusCode.ERROR });
		const result2 = enricher.enrich(span2, {});
		expect(result2["ho.context_rot.type"]).toBeUndefined();

		// Third error triggers cascade (2 errors after first)
		const span3 = mockSpan({ traceId, spanId: "err3", status: SpanStatusCode.ERROR });
		const result3 = enricher.enrich(span3, {});
		expect(result3["ho.context_rot.type"]).toBe("error_cascade");
		expect(result3["ho.context_rot.trigger_span_id"]).toBe("err3");
		expect(result3["ho.context_rot.cascade_depth"]).toBe(3);
	});

	it("detects repeated tool calls exceeding threshold", () => {
		const enricher = new ContextRotEnricher();
		const traceId = "cccc000000000000cccc000000000000";

		const toolAttrs: Attributes = {
			"gen_ai.tool.name": "read_file",
			"gen_ai.tool.call.arguments": '{"path": "/tmp/foo"}',
		};

		// Calls 1-3 are within threshold (default 3)
		for (let i = 1; i <= 3; i++) {
			const span = mockSpan({ traceId, spanId: `tool${i}` });
			const result = enricher.enrich(span, toolAttrs);
			expect(result["ho.context_rot.type"]).toBeUndefined();
		}

		// 4th identical call triggers detection (count 4 > threshold 3)
		const span4 = mockSpan({ traceId, spanId: "tool4" });
		const result4 = enricher.enrich(span4, toolAttrs);
		expect(result4["ho.context_rot.type"]).toBe("repeated_calls");
		expect(result4["ho.context_rot.trigger_span_id"]).toBe("tool4");
		expect(result4["ho.context_rot.repeat_count"]).toBe(4);
	});

	it("does not trigger false positives on normal spans", () => {
		const enricher = new ContextRotEnricher();
		const traceId = "dddd000000000000dddd000000000000";

		// Normal token usage (below 2x)
		const span1 = mockSpan({ traceId, spanId: "s1" });
		enricher.enrich(span1, { "gen_ai.usage.input_tokens": 100 });

		const span2 = mockSpan({ traceId, spanId: "s2" });
		const result2 = enricher.enrich(span2, { "gen_ai.usage.input_tokens": 180 });
		expect(result2["ho.context_rot.type"]).toBeUndefined();

		// Single error (no cascade)
		const span3 = mockSpan({ traceId, spanId: "s3", status: SpanStatusCode.ERROR });
		const result3 = enricher.enrich(span3, {});
		expect(result3["ho.context_rot.type"]).toBeUndefined();

		// Different tool calls (not repeated)
		const span4 = mockSpan({ traceId, spanId: "s4" });
		const result4 = enricher.enrich(span4, {
			"gen_ai.tool.name": "read_file",
			"gen_ai.tool.call.arguments": '{"path": "/a"}',
		});
		expect(result4["ho.context_rot.type"]).toBeUndefined();

		const span5 = mockSpan({ traceId, spanId: "s5" });
		const result5 = enricher.enrich(span5, {
			"gen_ai.tool.name": "read_file",
			"gen_ai.tool.call.arguments": '{"path": "/b"}',
		});
		expect(result5["ho.context_rot.type"]).toBeUndefined();
	});

	it("evicts stale traces after eviction period", () => {
		vi.useFakeTimers();
		const enricher = new ContextRotEnricher({ traceEvictionMs: 1000 });
		const traceId = "eeee000000000000eeee000000000000";

		// Establish a trace with first token count
		const span1 = mockSpan({ traceId, spanId: "s1" });
		enricher.enrich(span1, { "gen_ai.usage.input_tokens": 100 });

		// Advance time past eviction
		vi.advanceTimersByTime(2000);

		// New span on same trace should act as if fresh (firstInputTokens reset)
		const span2 = mockSpan({ traceId, spanId: "s2" });
		const result = enricher.enrich(span2, { "gen_ai.usage.input_tokens": 500 });
		// Should NOT detect bloat because the old trace was evicted, so 500 is the new baseline
		expect(result["ho.context_rot.type"]).toBeUndefined();

		vi.useRealTimers();
	});

	it("respects custom config thresholds", () => {
		const enricher = new ContextRotEnricher({
			tokenBloatThreshold: 1.5,
			cascadeMinErrors: 1,
			repeatCallThreshold: 1,
		});
		const traceId = "ffff000000000000ffff000000000000";

		// Token bloat with lower threshold (1.5x)
		const span1 = mockSpan({ traceId, spanId: "s1" });
		enricher.enrich(span1, { "gen_ai.usage.input_tokens": 100 });

		const span2 = mockSpan({ traceId, spanId: "s2" });
		const result = enricher.enrich(span2, { "gen_ai.usage.input_tokens": 160 });
		expect(result["ho.context_rot.type"]).toBe("token_bloat");
		expect(result["ho.context_rot.token_growth_ratio"]).toBeCloseTo(1.6);

		// Error cascade with lower threshold (cascadeMinErrors=1)
		const traceId2 = "1111000000000000111100000000000";
		const span3 = mockSpan({ traceId: traceId2, spanId: "e1", status: SpanStatusCode.ERROR });
		enricher.enrich(span3, {});

		const span4 = mockSpan({ traceId: traceId2, spanId: "e2", status: SpanStatusCode.ERROR });
		const result2 = enricher.enrich(span4, {});
		expect(result2["ho.context_rot.type"]).toBe("error_cascade");

		// Repeated calls with lower threshold (repeatCallThreshold=1)
		const traceId3 = "2222000000000000222200000000000";
		const toolAttrs: Attributes = {
			"gen_ai.tool.name": "bash",
			"gen_ai.tool.call.arguments": '{"cmd": "ls"}',
		};
		const span5 = mockSpan({ traceId: traceId3, spanId: "t1" });
		enricher.enrich(span5, toolAttrs);

		const span6 = mockSpan({ traceId: traceId3, spanId: "t2" });
		const result3 = enricher.enrich(span6, toolAttrs);
		expect(result3["ho.context_rot.type"]).toBe("repeated_calls");
	});
});
