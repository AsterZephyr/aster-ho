import type { Attributes } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ContextRotConfig, ContextRotType, TraceState } from "./types.js";

export interface RotDetection {
	readonly type: ContextRotType;
	readonly triggerSpanId: string;
	readonly tokenRatio?: number;
	readonly cascadeDepth?: number;
	readonly repeatCount?: number;
}

export interface UpdateResult {
	readonly state: TraceState;
	readonly rotDetected?: RotDetection;
}

const DEFAULT_TOKEN_BLOAT_THRESHOLD = 2.0;
const DEFAULT_CASCADE_MIN_ERRORS = 2;
const DEFAULT_REPEAT_CALL_THRESHOLD = 3;

export function createTraceState(traceId: string): TraceState {
	return {
		traceId,
		firstInputTokens: undefined,
		firstErrorSpanId: undefined,
		errorsAfterFirst: 0,
		toolCallCounts: new Map(),
		lastSeen: Date.now(),
	};
}

function hashToolCall(toolName: string, args: string): string {
	return JSON.stringify([toolName, args]);
}

export function updateWithSpan(
	state: TraceState,
	span: ReadableSpan,
	attrs: Attributes,
	config: ContextRotConfig = {},
): UpdateResult {
	const tokenBloatThreshold = config.tokenBloatThreshold ?? DEFAULT_TOKEN_BLOAT_THRESHOLD;
	const cascadeMinErrors = config.cascadeMinErrors ?? DEFAULT_CASCADE_MIN_ERRORS;
	const repeatCallThreshold = config.repeatCallThreshold ?? DEFAULT_REPEAT_CALL_THRESHOLD;

	const spanId = span.spanContext().spanId;
	const now = Date.now();

	let updatedState: TraceState = { ...state, lastSeen: now };

	// Check token bloat
	const inputTokens = attrs["gen_ai.usage.input_tokens"] as number | undefined;
	if (inputTokens !== undefined) {
		if (updatedState.firstInputTokens === undefined) {
			updatedState = { ...updatedState, firstInputTokens: inputTokens };
		} else {
			const ratio = inputTokens / updatedState.firstInputTokens;
			if (ratio > tokenBloatThreshold) {
				return {
					state: updatedState,
					rotDetected: {
						type: "token_bloat",
						triggerSpanId: spanId,
						tokenRatio: ratio,
					},
				};
			}
		}
	}

	// Check error cascade
	const isError = span.status.code === SpanStatusCode.ERROR;
	if (isError) {
		if (updatedState.firstErrorSpanId === undefined) {
			updatedState = { ...updatedState, firstErrorSpanId: spanId };
		} else {
			const newErrorCount = updatedState.errorsAfterFirst + 1;
			updatedState = { ...updatedState, errorsAfterFirst: newErrorCount };
			if (newErrorCount >= cascadeMinErrors) {
				return {
					state: updatedState,
					rotDetected: {
						type: "error_cascade",
						triggerSpanId: spanId,
						cascadeDepth: newErrorCount + 1, // include the first error
					},
				};
			}
		}
	}

	// Check repeated calls
	const toolName = attrs["gen_ai.tool.name"] as string | undefined;
	const toolArgs = attrs["gen_ai.tool.call.arguments"] as string | undefined;
	if (toolName !== undefined) {
		const key = hashToolCall(toolName, toolArgs ?? "");
		const currentCounts = new Map(updatedState.toolCallCounts);
		const newCount = (currentCounts.get(key) ?? 0) + 1;
		currentCounts.set(key, newCount);
		updatedState = { ...updatedState, toolCallCounts: currentCounts };

		if (newCount > repeatCallThreshold) {
			return {
				state: updatedState,
				rotDetected: {
					type: "repeated_calls",
					triggerSpanId: spanId,
					repeatCount: newCount,
				},
			};
		}
	}

	return { state: updatedState };
}
