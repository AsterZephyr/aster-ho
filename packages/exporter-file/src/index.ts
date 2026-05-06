import { appendFile, writeFile } from "node:fs/promises";
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

export interface FileExporterConfig {
	filePath: string;
	pretty?: boolean;
}

interface SerializedSpan {
	traceId: string;
	spanId: string;
	parentSpanId: string | undefined;
	name: string;
	kind: number;
	startTime: [number, number];
	endTime: [number, number];
	durationMs: number;
	status: { code: number; message?: string };
	attributes: Record<string, unknown>;
	events: Array<{
		name: string;
		time: [number, number];
		attributes: Record<string, unknown>;
	}>;
}

export class FileExporter implements SpanExporter {
	private readonly filePath: string;
	private readonly pretty: boolean;
	private pending: Promise<void> = Promise.resolve();

	constructor(config: FileExporterConfig) {
		this.filePath = config.filePath;
		this.pretty = config.pretty ?? false;
	}

	export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
		const lines = spans.map((span) => this.serialize(span));
		const content = `${lines.map((l) => (this.pretty ? JSON.stringify(l, null, 2) : JSON.stringify(l))).join("\n")}\n`;

		this.pending = this.pending
			.then(() => appendFile(this.filePath, content, "utf-8"))
			.then(() => {
				resultCallback({ code: ExportResultCode.SUCCESS });
			})
			.catch(() => {
				resultCallback({ code: ExportResultCode.FAILED });
			});
	}

	async shutdown(): Promise<void> {
		await this.pending;
	}

	forceFlush(): Promise<void> {
		return this.pending;
	}

	private serialize(span: ReadableSpan): SerializedSpan {
		const ctx = span.spanContext();
		const [startSec, startNano] = span.startTime;
		const [endSec, endNano] = span.endTime;
		const durationMs = (endSec - startSec) * 1000 + (endNano - startNano) / 1_000_000;

		return {
			traceId: ctx.traceId,
			spanId: ctx.spanId,
			parentSpanId: span.parentSpanContext?.spanId,
			name: span.name,
			kind: span.kind,
			startTime: span.startTime,
			endTime: span.endTime,
			durationMs,
			status: {
				code: span.status.code,
				...(span.status.message ? { message: span.status.message } : {}),
			},
			attributes: { ...span.attributes },
			events: span.events.map((e) => ({
				name: e.name,
				time: e.time,
				attributes: { ...(e.attributes ?? {}) },
			})),
		};
	}
}
