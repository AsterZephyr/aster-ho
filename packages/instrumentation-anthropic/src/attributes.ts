import type { Attributes } from "@opentelemetry/api";

export function requestAttributes(body: Record<string, unknown>): Attributes {
	const attrs: Attributes = {
		"gen_ai.operation.name": "chat",
		"gen_ai.system": "anthropic",
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
		if (usage.input_tokens !== undefined) {
			attrs["gen_ai.usage.input_tokens"] = usage.input_tokens;
		}
		if (usage.output_tokens !== undefined) {
			attrs["gen_ai.usage.output_tokens"] = usage.output_tokens;
		}
		if (usage.cache_read_input_tokens !== undefined) {
			attrs["gen_ai.usage.cache_read.input_tokens"] = usage.cache_read_input_tokens;
		}
		if (usage.cache_creation_input_tokens !== undefined) {
			attrs["gen_ai.usage.cache_creation.input_tokens"] = usage.cache_creation_input_tokens;
		}
	}

	if (response.stop_reason) {
		attrs["gen_ai.response.finish_reasons"] = [String(response.stop_reason)];
	}

	return attrs;
}
