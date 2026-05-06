import type { Attributes, SpanKind, SpanStatus } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

export interface LangfuseExporterConfig {
	publicKey: string;
	secretKey: string;
	endpoint?: string;
}

export class LangfuseExporter implements SpanExporter {
	private readonly endpoint: string;
	private readonly authHeader: string;

	constructor(config: LangfuseExporterConfig) {
		const base = config.endpoint ?? "https://cloud.langfuse.com";
		this.endpoint = `${base}/api/public/otel/v1/traces`;
		this.authHeader = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`;
	}

	export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
		const payload = this.toOTLPPayload(spans);

		fetch(this.endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: this.authHeader,
			},
			body: JSON.stringify(payload),
		})
			.then((res) => {
				resultCallback({
					code: res.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED,
				});
			})
			.catch(() => {
				resultCallback({ code: ExportResultCode.FAILED });
			});
	}

	async shutdown(): Promise<void> {}

	forceFlush(): Promise<void> {
		return Promise.resolve();
	}

	private toOTLPPayload(spans: ReadableSpan[]) {
		return {
			resourceSpans: [
				{
					resource: {
						attributes: this.encodeAttributes(spans[0]?.resource?.attributes ?? {}),
					},
					scopeSpans: [
						{
							scope: { name: "@ho/sdk", version: "0.1.0" },
							spans: spans.map((s) => this.convertSpan(s)),
						},
					],
				},
			],
		};
	}

	private convertSpan(span: ReadableSpan) {
		const ctx = span.spanContext();
		return {
			traceId: ctx.traceId,
			spanId: ctx.spanId,
			parentSpanId: span.parentSpanContext?.spanId ?? "",
			name: span.name,
			kind: this.encodeKind(span.kind),
			startTimeUnixNano: this.hrTimeToNano(span.startTime),
			endTimeUnixNano: this.hrTimeToNano(span.endTime),
			attributes: this.encodeAttributes(span.attributes),
			status: this.encodeStatus(span.status),
			events: span.events.map((e) => ({
				timeUnixNano: this.hrTimeToNano(e.time),
				name: e.name,
				attributes: this.encodeAttributes(e.attributes ?? {}),
			})),
		};
	}

	private encodeAttributes(attrs: Attributes) {
		return Object.entries(attrs).map(([key, value]) => ({
			key,
			value: this.encodeValue(value),
		}));
	}

	private encodeValue(value: unknown): Record<string, unknown> {
		if (typeof value === "string") return { stringValue: value };
		if (typeof value === "number") {
			return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
		}
		if (typeof value === "boolean") return { boolValue: value };
		if (Array.isArray(value)) {
			return { arrayValue: { values: value.map((v) => this.encodeValue(v)) } };
		}
		return { stringValue: String(value) };
	}

	private encodeKind(kind: SpanKind): number {
		// OTEL protobuf: UNSPECIFIED=0, INTERNAL=1, SERVER=2, CLIENT=3, PRODUCER=4, CONSUMER=5
		const map: Record<number, number> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 };
		return map[kind] ?? 0;
	}

	private encodeStatus(status: SpanStatus) {
		if (status.code === SpanStatusCode.ERROR) {
			return { code: 2, message: status.message ?? "" };
		}
		if (status.code === SpanStatusCode.OK) {
			return { code: 1 };
		}
		return {};
	}

	private hrTimeToNano(hrTime: [number, number]): string {
		const [seconds, nanos] = hrTime;
		return String(BigInt(seconds) * BigInt(1_000_000_000) + BigInt(nanos));
	}
}
