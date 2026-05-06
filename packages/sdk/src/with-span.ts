import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { Span, Tracer } from "@opentelemetry/api";

export function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
	const tracer = trace.getTracer("@ho/sdk", "0.1.0");
	return tracer.startActiveSpan(name, async (span) => {
		try {
			const result = await fn(span);
			span.end();
			return result;
		} catch (err) {
			span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
			span.end();
			throw err;
		}
	});
}
