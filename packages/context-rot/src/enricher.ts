import type { SpanEnricher } from "@ho/sdk";
import { HoAttributes } from "@ho/sdk";
import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { createTraceState, updateWithSpan } from "./accumulator.js";
import type { ContextRotConfig } from "./types.js";
import type { TraceState } from "./types.js";

export class ContextRotEnricher implements SpanEnricher {
	private readonly config: ContextRotConfig;
	private readonly traces: Map<string, TraceState> = new Map();
	private lastEviction: number = Date.now();

	constructor(config: ContextRotConfig = {}) {
		this.config = config;
	}

	enrich(span: ReadableSpan, attrs: Attributes): Attributes {
		const traceId = span.spanContext().traceId;
		const evictionMs = this.config.traceEvictionMs ?? 300_000;

		// Periodically evict stale traces
		const now = Date.now();
		if (now - this.lastEviction > evictionMs) {
			this.evictStaleTraces(now, evictionMs);
			this.lastEviction = now;
		}

		// Get or create trace state
		const existing = this.traces.get(traceId);
		const state = existing ?? createTraceState(traceId);

		// Update with this span
		const result = updateWithSpan(state, span, attrs, this.config);
		this.traces.set(traceId, result.state);

		// If rot detected, add attributes
		if (result.rotDetected) {
			const rot = result.rotDetected;
			const rotAttrs: Record<string, string | number> = {
				[HoAttributes.CONTEXT_ROT_TYPE]: rot.type,
				[HoAttributes.CONTEXT_ROT_TRIGGER_SPAN]: rot.triggerSpanId,
			};

			if (rot.tokenRatio !== undefined) {
				rotAttrs[HoAttributes.CONTEXT_ROT_TOKEN_RATIO] = rot.tokenRatio;
			}
			if (rot.cascadeDepth !== undefined) {
				rotAttrs[HoAttributes.CONTEXT_ROT_CASCADE_DEPTH] = rot.cascadeDepth;
			}
			if (rot.repeatCount !== undefined) {
				rotAttrs[HoAttributes.CONTEXT_ROT_REPEAT_COUNT] = rot.repeatCount;
			}

			return { ...attrs, ...rotAttrs };
		}

		return attrs;
	}

	private evictStaleTraces(now: number, evictionMs: number): void {
		for (const [traceId, state] of this.traces) {
			if (now - state.lastSeen > evictionMs) {
				this.traces.delete(traceId);
			}
		}
	}
}
