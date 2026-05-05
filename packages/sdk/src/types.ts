import type { Attributes, Span, SpanContext } from "@opentelemetry/api";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import type { ReadableSpan, SpanExporter, TimedEvent } from "@opentelemetry/sdk-trace-base";

export interface SpanEnricher {
	enrich(span: ReadableSpan, attrs: Attributes): Attributes;
}

export interface HoConfig {
	serviceName?: string;
	instrumentations?: Instrumentation[];
	enrichers?: SpanEnricher[];
	exporters?: SpanExporter[];
	dev?: boolean;
	captureContent?: CaptureContentConfig;
}

export interface CaptureContentConfig {
	input?: boolean;
	output?: boolean;
	toolArguments?: boolean;
	toolResults?: boolean;
}

export const GenAIAttributes = {
	OPERATION_NAME: "gen_ai.operation.name",
	PROVIDER_NAME: "gen_ai.provider.name",
	REQUEST_MODEL: "gen_ai.request.model",
	RESPONSE_MODEL: "gen_ai.response.model",
	REQUEST_MAX_TOKENS: "gen_ai.request.max_tokens",
	REQUEST_TEMPERATURE: "gen_ai.request.temperature",
	REQUEST_TOP_P: "gen_ai.request.top_p",
	REQUEST_STREAM: "gen_ai.request.stream",
	RESPONSE_ID: "gen_ai.response.id",
	RESPONSE_FINISH_REASONS: "gen_ai.response.finish_reasons",
	RESPONSE_TIME_TO_FIRST_CHUNK: "gen_ai.response.time_to_first_chunk",
	USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
	USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
	USAGE_CACHE_READ_INPUT_TOKENS: "gen_ai.usage.cache_read.input_tokens",
	USAGE_CACHE_CREATION_INPUT_TOKENS: "gen_ai.usage.cache_creation.input_tokens",
	CONVERSATION_ID: "gen_ai.conversation.id",
	AGENT_NAME: "gen_ai.agent.name",
	AGENT_ID: "gen_ai.agent.id",
	TOOL_NAME: "gen_ai.tool.name",
	TOOL_CALL_ID: "gen_ai.tool.call.id",
	TOOL_CALL_ARGUMENTS: "gen_ai.tool.call.arguments",
	TOOL_CALL_RESULT: "gen_ai.tool.call.result",
	INPUT_MESSAGES: "gen_ai.input.messages",
	OUTPUT_MESSAGES: "gen_ai.output.messages",
	SYSTEM_INSTRUCTIONS: "gen_ai.system_instructions",
} as const;

export const HoAttributes = {
	COST_USD: "ho.cost.usd",
	ERROR_CATEGORY: "ho.error.category",
	ERROR_FINGERPRINT: "ho.error.fingerprint",
	ERROR_MODEL_TOOL: "ho.error.model_tool",
	TOOL_REPAIRED: "ho.tool.repaired",
	TOOL_REPAIR_STRATEGY: "ho.tool.repair_strategy",
	AGENT_ITERATIONS: "ho.agent.iterations",
	EVAL_RUN_ID: "ho.eval.run_id",
	EVAL_DATASET: "ho.eval.dataset",
	EVAL_SAMPLE_ID: "ho.eval.sample_id",
	EVAL_SCORE: "ho.eval.score",
	SANDBOX_TYPE: "ho.sandbox.type",
	SANDBOX_ID: "ho.sandbox.id",
	SANDBOX_EXIT_CODE: "ho.sandbox.exit_code",
	SANDBOX_TIMED_OUT: "ho.sandbox.timed_out",
	SANDBOX_DURATION_MS: "ho.sandbox.duration_ms",
	CONTEXT_ROT_TYPE: "ho.context_rot.type",
	CONTEXT_ROT_TRIGGER_SPAN: "ho.context_rot.trigger_span_id",
	CONTEXT_ROT_TOKEN_RATIO: "ho.context_rot.token_growth_ratio",
	CONTEXT_ROT_CASCADE_DEPTH: "ho.context_rot.cascade_depth",
	CONTEXT_ROT_REPEAT_COUNT: "ho.context_rot.repeat_count",
	HARNESS_VERSION: "ho.harness.version",
} as const;

export interface ReceiverAdapter {
	readonly name: string;
	ingest(data: unknown): void;
	start?(): Promise<void>;
	shutdown?(): Promise<void>;
}
