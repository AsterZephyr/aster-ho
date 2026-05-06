import { SpanStatusCode, trace } from "@opentelemetry/api";

export interface TraceOptions {
	name?: string;
}

export function hoTrace(opts: TraceOptions = {}) {
	return (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) => {
		const original = descriptor.value;
		const spanName = opts.name ?? propertyKey;

		descriptor.value = function (...args: unknown[]) {
			const tracer = trace.getTracer("@ho/sdk", "0.1.0");
			return tracer.startActiveSpan(spanName, async (span) => {
				try {
					const result = await original.apply(this, args);
					span.end();
					return result;
				} catch (err) {
					span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
					span.end();
					throw err;
				}
			});
		};

		return descriptor;
	};
}
