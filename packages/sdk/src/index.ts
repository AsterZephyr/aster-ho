export { init, shutdown, HoConfigError } from "./init.js";
export { validateConfig } from "./config-schema.js";
export { withSpan } from "./with-span.js";
export {
	withAgentLoop,
	AgentLoopTimeoutError,
	AgentLoopMaxIterationsError,
} from "./with-agent-loop.js";
export type { AgentLoopContext, AgentLoopOptions } from "./with-agent-loop.js";
export { wrapLLMCall } from "./wrap.js";
export type { WrapLLMCallOptions } from "./wrap.js";
export { hoTrace } from "./trace.js";
export { EnrichingExporter } from "./enriching-exporter.js";
export { ReadableSpanWrapper } from "./readable-span-wrapper.js";
export { SUPPRESS_INSTRUMENTATION_KEY } from "./constants.js";
export { GenAIAttributes, HoAttributes } from "./types.js";
export type { SpanEnricher, HoConfig, CaptureContentConfig, ReceiverAdapter } from "./types.js";
