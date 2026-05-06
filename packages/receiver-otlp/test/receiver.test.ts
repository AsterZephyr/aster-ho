import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeOtlpRequest } from "../src/decoder.js";
import { OtlpReceiver } from "../src/receiver.js";
import type { ExportTraceServiceRequest } from "../src/types.js";

const sampleRequest: ExportTraceServiceRequest = {
	resourceSpans: [
		{
			resource: {
				attributes: [{ key: "service.name", value: { stringValue: "test-agent" } }],
			},
			scopeSpans: [
				{
					scope: { name: "ho-sdk", version: "0.1.0" },
					spans: [
						{
							traceId: "abc123def456",
							spanId: "span001",
							name: "chat gpt-4",
							kind: 1,
							startTimeUnixNano: "1700000000000000000",
							endTimeUnixNano: "1700000001500000000",
							attributes: [
								{ key: "gen_ai.request.model", value: { stringValue: "gpt-4" } },
								{ key: "gen_ai.usage.input_tokens", value: { intValue: "150" } },
								{ key: "gen_ai.usage.output_tokens", value: { intValue: "50" } },
							],
							status: { code: 1 },
						},
						{
							traceId: "abc123def456",
							spanId: "span002",
							parentSpanId: "span001",
							name: "tool/web_search",
							kind: 1,
							startTimeUnixNano: "1700000000500000000",
							endTimeUnixNano: "1700000001000000000",
							attributes: [{ key: "gen_ai.tool.name", value: { stringValue: "web_search" } }],
							status: { code: 2, message: "timeout" },
						},
					],
				},
			],
		},
	],
};

describe("decoder", () => {
	it("decodes OTLP JSON to ReadableSpan array", () => {
		const spans = decodeOtlpRequest(sampleRequest);
		expect(spans).toHaveLength(2);
	});

	it("maps span attributes correctly", () => {
		const spans = decodeOtlpRequest(sampleRequest);
		expect(spans[0].attributes["gen_ai.request.model"]).toBe("gpt-4");
		expect(spans[0].attributes["gen_ai.usage.input_tokens"]).toBe(150);
	});

	it("maps span context (traceId, spanId)", () => {
		const spans = decodeOtlpRequest(sampleRequest);
		expect(spans[0].spanContext().traceId).toBe("abc123def456");
		expect(spans[0].spanContext().spanId).toBe("span001");
	});

	it("maps parent span ID", () => {
		const spans = decodeOtlpRequest(sampleRequest);
		expect(spans[1].parentSpanId).toBe("span001");
	});

	it("maps error status", () => {
		const spans = decodeOtlpRequest(sampleRequest);
		expect(spans[1].status.code).toBe(2); // ERROR
		expect(spans[1].status.message).toBe("timeout");
	});

	it("maps timing correctly", () => {
		const spans = decodeOtlpRequest(sampleRequest);
		const [startSec] = spans[0].startTime;
		expect(startSec).toBe(1700000000);
	});
});

describe("OtlpReceiver", () => {
	let receiver: OtlpReceiver;
	let exported: ReadableSpan[];

	const mockExporter: SpanExporter = {
		export(spans, cb) {
			exported.push(...spans);
			cb({ code: ExportResultCode.SUCCESS });
		},
		shutdown: async () => {},
	};

	beforeEach(async () => {
		exported = [];
		receiver = new OtlpReceiver({ port: 0, host: "127.0.0.1" });
	});

	afterEach(async () => {
		await receiver.shutdown();
	});

	it("accepts OTLP POST and feeds pipeline", async () => {
		await receiver.start(mockExporter);
		const { port } = receiver.address;

		const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(sampleRequest),
		});

		expect(res.status).toBe(200);
		expect(exported).toHaveLength(2);
		expect(exported[0].name).toBe("chat gpt-4");
	});

	it("returns 404 for non-trace paths", async () => {
		await receiver.start(mockExporter);
		const { port } = receiver.address;

		const res = await fetch(`http://127.0.0.1:${port}/other`, { method: "POST" });
		expect(res.status).toBe(404);
	});

	it("returns 400 for invalid JSON", async () => {
		await receiver.start(mockExporter);
		const { port } = receiver.address;

		const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
			method: "POST",
			body: "not json",
		});
		expect(res.status).toBe(400);
	});
});
