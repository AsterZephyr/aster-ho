import { SpanStatusCode } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { SpanEnricher } from "@ho/sdk";
import { GenAIAttributes, HoAttributes } from "@ho/sdk";
import { computeFingerprint } from "./fingerprint.js";

export { computeFingerprint } from "./fingerprint.js";

export interface ClassificationRule {
	readonly pattern: RegExp;
	readonly category: string;
}

export interface UnknownErrorEntry {
	readonly fingerprint: string;
	readonly message: string;
	readonly traceId: string;
	readonly model: string;
	readonly tool: string;
	readonly timestamp: number;
}

export interface ErrorClassifyEnricherConfig {
	readonly customRules?: ClassificationRule[];
	readonly unknownCallback?: (entry: UnknownErrorEntry) => void;
}

const DEFAULT_RULES: ClassificationRule[] = [
	{ pattern: /schema validation failed|invalid response format|unexpected response type/i, category: "schema_mismatch" },
	{ pattern: /json parse|schema validation|missing required|invalid.*argument/i, category: "invalid_arguments" },
	{ pattern: /rate limit|overloaded|503|529|too many requests/i, category: "provider_error" },
	{ pattern: /timeout|deadline exceeded|timed out/i, category: "timeout" },
	{ pattern: /cancelled|aborted|abort/i, category: "user_aborted" },
	{ pattern: /context length|token limit|max.*tokens.*exceeded/i, category: "context_overflow" },
	{ pattern: /401|403|invalid api key|unauthorized|forbidden/i, category: "auth_error" },
	{ pattern: /ECONNREFUSED|ENOTFOUND|DNS|socket hang up|ETIMEDOUT/i, category: "network_error" },
	{ pattern: /content policy|safety filter|content_filter|moderation/i, category: "content_filter" },
	{ pattern: /tool not found|unknown tool|no such function|function not available/i, category: "tool_not_found" },
	{ pattern: /tool execution failed|tool error|function threw|runtime error in tool/i, category: "tool_execution_error" },
	{ pattern: /quota exceeded|billing|rate limit exceeded|insufficient credits/i, category: "quota_exceeded" },
	{ pattern: /model not found|model deprecated|model unavailable|model does not exist/i, category: "model_not_available" },
];

export class ErrorClassifyEnricher implements SpanEnricher {
	private readonly rules: ClassificationRule[];
	private readonly unknownCallback?: (entry: UnknownErrorEntry) => void;

	constructor(config: ErrorClassifyEnricherConfig = {}) {
		this.rules = [...(config.customRules ?? []), ...DEFAULT_RULES];
		this.unknownCallback = config.unknownCallback;
	}

	enrich(span: ReadableSpan, attrs: Attributes): Attributes {
		if (span.status.code !== SpanStatusCode.ERROR) {
			return attrs;
		}

		const message = span.status.message ?? "";
		const category = this.classify(message);
		const fingerprint = computeFingerprint(message);

		const model = String(span.attributes[GenAIAttributes.REQUEST_MODEL] ?? "");
		const tool = String(span.attributes[GenAIAttributes.TOOL_NAME] ?? "");
		const modelTool = `${model}:${tool}`;

		const enriched: Attributes = {
			...attrs,
			[HoAttributes.ERROR_CATEGORY]: category,
			[HoAttributes.ERROR_FINGERPRINT]: fingerprint,
			[HoAttributes.ERROR_MODEL_TOOL]: modelTool,
		};

		if (category === "unknown" && this.unknownCallback) {
			const traceId = span.spanContext().traceId;
			this.unknownCallback({
				fingerprint,
				message,
				traceId,
				model,
				tool,
				timestamp: Date.now(),
			});
		}

		return enriched;
	}

	private classify(message: string): string {
		for (const rule of this.rules) {
			if (rule.pattern.test(message)) {
				return rule.category;
			}
		}
		return "unknown";
	}
}
