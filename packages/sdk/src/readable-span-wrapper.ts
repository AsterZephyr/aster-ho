import type {
	Attributes,
	HrTime,
	Link,
	SpanContext,
	SpanKind,
	SpanStatus,
} from "@opentelemetry/api";
import type { InstrumentationScope } from "@opentelemetry/core";
import type { Resource } from "@opentelemetry/resources";
import type { ReadableSpan, TimedEvent } from "@opentelemetry/sdk-trace-base";

export class ReadableSpanWrapper implements ReadableSpan {
	private readonly _inner: ReadableSpan;
	private readonly _attributes: Attributes;

	constructor(inner: ReadableSpan, attributes: Attributes) {
		this._inner = inner;
		this._attributes = attributes;
	}

	get name(): string {
		return this._inner.name;
	}

	get kind(): SpanKind {
		return this._inner.kind;
	}

	get parentSpanContext(): SpanContext | undefined {
		return this._inner.parentSpanContext;
	}

	get startTime(): HrTime {
		return this._inner.startTime;
	}

	get endTime(): HrTime {
		return this._inner.endTime;
	}

	get duration(): HrTime {
		return this._inner.duration;
	}

	get status(): SpanStatus {
		return this._inner.status;
	}

	get attributes(): Attributes {
		return this._attributes;
	}

	get links(): Link[] {
		return this._inner.links;
	}

	get events(): TimedEvent[] {
		return this._inner.events;
	}

	get ended(): boolean {
		return this._inner.ended;
	}

	get resource(): Resource {
		return this._inner.resource;
	}

	get instrumentationScope(): InstrumentationScope {
		return this._inner.instrumentationScope;
	}

	get droppedAttributesCount(): number {
		return this._inner.droppedAttributesCount;
	}

	get droppedEventsCount(): number {
		return this._inner.droppedEventsCount;
	}

	get droppedLinksCount(): number {
		return this._inner.droppedLinksCount;
	}

	spanContext(): SpanContext {
		return this._inner.spanContext();
	}
}
