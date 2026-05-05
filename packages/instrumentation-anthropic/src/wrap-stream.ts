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
	let stopReason: string | undefined;
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
									...(stopReason ? { "gen_ai.response.finish_reasons": [stopReason] } : {}),
								});
								span.end();
								return result;
							}

							const event = result.value as Record<string, unknown>;

							if (!firstChunkReceived) {
								firstChunkReceived = true;
								const ttfc = (performance.now() - startTime) / 1000;
								span.setAttribute("gen_ai.response.time_to_first_chunk", ttfc);
							}

							if (event.type === "message_start") {
								const message = event.message as Record<string, unknown> | undefined;
								if (message?.model) {
									responseModel = String(message.model);
								}
								const usage = message?.usage as Record<string, number> | undefined;
								if (usage?.input_tokens !== undefined) {
									inputTokens = usage.input_tokens;
								}
							}

							if (event.type === "message_delta") {
								const delta = event.delta as Record<string, unknown> | undefined;
								if (delta?.stop_reason) {
									stopReason = String(delta.stop_reason);
								}
								const usage = event.usage as Record<string, number> | undefined;
								if (usage?.output_tokens !== undefined) {
									outputTokens = usage.output_tokens;
								}
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
