import type { SpanEnricher } from "@ho/sdk";
import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { type ModelPricing, defaultPricing } from "./pricing.js";

export { defaultPricing, mergePricing, type ModelPricing } from "./pricing.js";

export interface CostEnricherConfig {
	pricing?: Record<string, ModelPricing>;
}

export class CostEnricher implements SpanEnricher {
	private readonly pricing: Record<string, ModelPricing>;

	constructor(config: CostEnricherConfig = {}) {
		this.pricing = config.pricing ?? defaultPricing;
	}

	enrich(span: ReadableSpan, attrs: Attributes): Attributes {
		const inputTokens = attrs["gen_ai.usage.input_tokens"] as number | undefined;
		if (inputTokens === undefined) return attrs;

		const model = (attrs["gen_ai.response.model"] ?? attrs["gen_ai.request.model"]) as
			| string
			| undefined;
		if (!model) return attrs;

		const pricing = this.resolvePricing(model);
		if (!pricing) return attrs;

		const outputTokens = (attrs["gen_ai.usage.output_tokens"] as number) ?? 0;
		const cacheRead = (attrs["gen_ai.usage.cache_read.input_tokens"] as number) ?? 0;
		const cacheCreation = (attrs["gen_ai.usage.cache_creation.input_tokens"] as number) ?? 0;

		const cacheReadRate = pricing.cacheReadPerToken ?? pricing.inputPerToken * 0.1;
		const cacheCreationRate = pricing.cacheCreationPerToken ?? pricing.inputPerToken * 1.25;

		const cost =
			(inputTokens - cacheRead) * pricing.inputPerToken +
			cacheRead * cacheReadRate +
			cacheCreation * cacheCreationRate +
			outputTokens * pricing.outputPerToken;

		return { ...attrs, "ho.cost.usd": cost };
	}

	private resolvePricing(model: string): ModelPricing | undefined {
		if (this.pricing[model]) return this.pricing[model];

		// Prefix matching: "gpt-4o-2024-11-20" → "gpt-4o"
		const keys = Object.keys(this.pricing).sort((a, b) => b.length - a.length);
		for (const key of keys) {
			if (model.startsWith(key)) return this.pricing[key];
		}
		return undefined;
	}
}
