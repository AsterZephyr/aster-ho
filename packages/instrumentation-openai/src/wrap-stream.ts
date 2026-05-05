import { performance } from "node:perf_hooks";
import type { Span } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";

interface StreamHooks {
	span: Span;
	startTime: number;
}

export function wrapStream<T extends AsyncIterable<unknown>>(stream: T, hooks: StreamHooks): T {
	const { span, startTime } = hooks;
	let firstChunkReceived = false;
	let inputTokens = 0;
	let outputTokens = 0;
	let finishReason: string | undefined;
	let responseModel: string | undefined;

	const originalIterator = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator].bind(stream);

	const wrapped = Object.create(stream, {
		[Symbol.asyncIterator]: {
			value() {
				const iter = originalIterator();
				return {
					async next() {
						try {
							const result = await iter.next();
							if (result.done) {
								span.setAttributes({
									...(responseModel ? { "gen_ai.response.model": responseModel } : {}),
									"gen_ai.usage.input_tokens": inputTokens,
									"gen_ai.usage.output_tokens": outputTokens,
									...(finishReason ? { "gen_ai.response.finish_reasons": [finishReason] } : {}),
								});
								span.end();
								return result;
							}

							const chunk = result.value as Record<string, unknown>;

							if (!firstChunkReceived) {
								firstChunkReceived = true;
								const ttfc = (performance.now() - startTime) / 1000;
								span.setAttribute("gen_ai.response.time_to_first_chunk", ttfc);
							}

							if (chunk.usage) {
								const usage = chunk.usage as Record<string, number>;
								inputTokens = usage.prompt_tokens ?? inputTokens;
								outputTokens = usage.completion_tokens ?? outputTokens;
							}

							if (chunk.model) {
								responseModel = chunk.model as string;
							}

							const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
							if (choices?.[0]?.finish_reason) {
								finishReason = choices[0].finish_reason as string;
							}

							return result;
						} catch (err) {
							span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
							span.end();
							throw err;
						}
					},
				};
			},
		},
	});

	return wrapped as T;
}
