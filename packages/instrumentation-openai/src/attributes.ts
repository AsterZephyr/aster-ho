import type { Attributes } from "@opentelemetry/api";

export function requestAttributes(body: Record<string, unknown>): Attributes {
	const attrs: Attributes = {
		"gen_ai.operation.name": "chat",
		"gen_ai.system": "openai",
		"gen_ai.request.model": String(body.model ?? "unknown"),
	};

	if (body.temperature !== undefined) {
		attrs["gen_ai.request.temperature"] = body.temperature as number;
	}
	if (body.top_p !== undefined) {
		attrs["gen_ai.request.top_p"] = body.top_p as number;
	}
	if (body.max_tokens !== undefined) {
		attrs["gen_ai.request.max_tokens"] = body.max_tokens as number;
	}
	if (body.max_completion_tokens !== undefined) {
		attrs["gen_ai.request.max_tokens"] = body.max_completion_tokens as number;
	}
	if (body.stream) {
		attrs["gen_ai.request.stream"] = true;
	}

	return attrs;
}

export function responseAttributes(response: Record<string, unknown>): Attributes {
	const attrs: Attributes = {};

	if (response.model) {
		attrs["gen_ai.response.model"] = String(response.model);
	}

	const usage = response.usage as Record<string, number> | undefined;
	if (usage) {
		if (usage.prompt_tokens !== undefined) {
			attrs["gen_ai.usage.input_tokens"] = usage.prompt_tokens;
		}
		if (usage.completion_tokens !== undefined) {
			attrs["gen_ai.usage.output_tokens"] = usage.completion_tokens;
		}
		if (usage.prompt_tokens_details) {
			const details = usage.prompt_tokens_details as unknown as Record<string, number>;
			if (details.cached_tokens !== undefined) {
				attrs["gen_ai.usage.cache_read.input_tokens"] = details.cached_tokens;
			}
		}
	}

	const choices = response.choices as Array<Record<string, unknown>> | undefined;
	if (choices?.length) {
		const reasons = choices.map((c) => c.finish_reason as string).filter(Boolean);
		if (reasons.length) {
			attrs["gen_ai.response.finish_reasons"] = reasons;
		}
	}

	return attrs;
}
