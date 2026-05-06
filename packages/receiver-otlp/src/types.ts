export interface OtlpReceiverConfig {
	readonly port?: number;
	readonly host?: string;
	readonly path?: string;
	readonly maxBodySize?: number;
}

export interface OtlpKeyValue {
	readonly key: string;
	readonly value: {
		stringValue?: string;
		intValue?: string;
		doubleValue?: number;
		boolValue?: boolean;
	};
}

export interface OtlpSpan {
	readonly traceId: string;
	readonly spanId: string;
	readonly parentSpanId?: string;
	readonly name: string;
	readonly kind: number;
	readonly startTimeUnixNano: string;
	readonly endTimeUnixNano: string;
	readonly attributes?: readonly OtlpKeyValue[];
	readonly status?: { code?: number; message?: string };
}

export interface OtlpScopeSpans {
	readonly scope?: { name?: string; version?: string };
	readonly spans: readonly OtlpSpan[];
}

export interface OtlpResourceSpans {
	readonly resource?: { attributes?: readonly OtlpKeyValue[] };
	readonly scopeSpans: readonly OtlpScopeSpans[];
}

export interface ExportTraceServiceRequest {
	readonly resourceSpans: readonly OtlpResourceSpans[];
}
