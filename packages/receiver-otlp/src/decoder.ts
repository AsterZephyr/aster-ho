import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ExportTraceServiceRequest, OtlpKeyValue, OtlpSpan } from "./types.js";

export function decodeOtlpRequest(body: ExportTraceServiceRequest): ReadableSpan[] {
	const spans: ReadableSpan[] = [];

	for (const resourceSpans of body.resourceSpans) {
		const resourceAttrs = decodeAttributes(resourceSpans.resource?.attributes ?? []);

		for (const scopeSpans of resourceSpans.scopeSpans) {
			for (const otlpSpan of scopeSpans.spans) {
				spans.push(toReadableSpan(otlpSpan, resourceAttrs));
			}
		}
	}

	return spans;
}

function toReadableSpan(otlp: OtlpSpan, resourceAttributes: Attributes): ReadableSpan {
	const startNano = BigInt(otlp.startTimeUnixNano);
	const endNano = BigInt(otlp.endTimeUnixNano);

	const startSec = Number(startNano / 1_000_000_000n);
	const startNanoRem = Number(startNano % 1_000_000_000n);
	const endSec = Number(endNano / 1_000_000_000n);
	const endNanoRem = Number(endNano % 1_000_000_000n);

	const attributes = decodeAttributes(otlp.attributes ?? []);
	const statusCode = otlp.status?.code === 2 ? SpanStatusCode.ERROR : SpanStatusCode.OK;

	return {
		name: otlp.name,
		kind: decodeSpanKind(otlp.kind),
		spanContext: () => ({
			traceId: otlp.traceId,
			spanId: otlp.spanId,
			traceFlags: 1,
			isRemote: true,
		}),
		parentSpanId: otlp.parentSpanId,
		startTime: [startSec, startNanoRem],
		endTime: [endSec, endNanoRem],
		status: { code: statusCode, message: otlp.status?.message },
		attributes,
		resource: {
			attributes: resourceAttributes,
			merge: () => ({ attributes: resourceAttributes }),
		} as any,
		instrumentationLibrary: { name: "otlp-receiver" },
		links: [],
		events: [],
		duration: [endSec - startSec, endNanoRem - startNanoRem],
		ended: true,
		droppedAttributesCount: 0,
		droppedEventsCount: 0,
		droppedLinksCount: 0,
	} as unknown as ReadableSpan;
}

function decodeSpanKind(kind: number): SpanKind {
	switch (kind) {
		case 1:
			return SpanKind.INTERNAL;
		case 2:
			return SpanKind.SERVER;
		case 3:
			return SpanKind.CLIENT;
		case 4:
			return SpanKind.PRODUCER;
		case 5:
			return SpanKind.CONSUMER;
		default:
			return SpanKind.INTERNAL;
	}
}

function decodeAttributes(kvs: readonly OtlpKeyValue[]): Attributes {
	const attrs: Attributes = {};
	for (const kv of kvs) {
		const v = kv.value;
		if (v.stringValue !== undefined) attrs[kv.key] = v.stringValue;
		else if (v.intValue !== undefined) attrs[kv.key] = Number(v.intValue);
		else if (v.doubleValue !== undefined) attrs[kv.key] = v.doubleValue;
		else if (v.boolValue !== undefined) attrs[kv.key] = v.boolValue;
	}
	return attrs;
}
