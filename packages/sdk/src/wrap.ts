import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";
import { SUPPRESS_INSTRUMENTATION_KEY } from "./constants.js";

export interface WrapLLMCallOptions {
	provider: string;
	model?: string;
}

export function wrapLLMCall<TArgs extends unknown[], TReturn>(
	fn: (...args: TArgs) => Promise<TReturn>,
	opts: WrapLLMCallOptions,
): (...args: TArgs) => Promise<TReturn> {
	const tracer = trace.getTracer("@ho/sdk", "0.1.0");

	return async (...args: TArgs): Promise<TReturn> =>
		tracer.startActiveSpan(`chat ${opts.model ?? "unknown"}`, async (span: Span) => {
			span.setAttribute("gen_ai.operation.name", "chat");
			span.setAttribute("gen_ai.provider.name", opts.provider);
			if (opts.model) span.setAttribute("gen_ai.request.model", opts.model);

			const suppressedCtx = context.active().setValue(SUPPRESS_INSTRUMENTATION_KEY, true);

			return context.with(suppressedCtx, async () => {
				try {
					const result = await fn(...args);
					span.end();
					return result;
				} catch (err) {
					span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
					span.end();
					throw err;
				}
			});
		});
}
