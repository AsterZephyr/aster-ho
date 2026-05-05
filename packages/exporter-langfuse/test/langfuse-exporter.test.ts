import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { LangfuseExporter } from "../src/index.js";

function mockSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
	return {
		name: "chat gpt-4o",
		kind: 2, // CLIENT
		parentSpanId: "parent123456789a",
		startTime: [1700000000, 0] as [number, number],
		endTime: [1700000001, 500000000] as [number, number],
		duration: [1, 500000000] as [number, number],
		status: { code: SpanStatusCode.OK },
		attributes: {
			"gen_ai.operation.name": "chat",
			"gen_ai.request.model": "gpt-4o",
			"gen_ai.usage.input_tokens": 100,
			"gen_ai.usage.output_tokens": 50,
		},
		links: [],
		events: [],
		ended: true,
		resource: { attributes: { "service.name": "test-agent" } } as any,
		instrumentationLibrary: { name: "@ho/sdk", version: "0.1.0" },
		droppedAttributesCount: 0,
		droppedEventsCount: 0,
		droppedLinksCount: 0,
		spanContext: () => ({
			traceId: "abcdef1234567890abcdef1234567890",
			spanId: "1234567890abcdef",
			traceFlags: 1,
		}),
		...overrides,
	} as unknown as ReadableSpan;
}

describe("LangfuseExporter", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends correct OTLP payload to Langfuse endpoint", async () => {
		const exporter = new LangfuseExporter({
			publicKey: "pk-test",
			secretKey: "sk-test",
		});

		await new Promise<void>((resolve) => {
			exporter.export([mockSpan()], () => resolve());
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe("https://cloud.langfuse.com/api/public/otel/v1/traces");
		expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from("pk-test:sk-test").toString("base64")}`);
		expect(opts.headers["Content-Type"]).toBe("application/json");

		const body = JSON.parse(opts.body);
		expect(body.resourceSpans).toHaveLength(1);
		const span = body.resourceSpans[0].scopeSpans[0].spans[0];
		expect(span.traceId).toBe("abcdef1234567890abcdef1234567890");
		expect(span.spanId).toBe("1234567890abcdef");
		expect(span.name).toBe("chat gpt-4o");
	});

	it("encodes attributes correctly", async () => {
		const exporter = new LangfuseExporter({
			publicKey: "pk",
			secretKey: "sk",
		});

		await new Promise<void>((resolve) => {
			exporter.export([mockSpan()], () => resolve());
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const attrs = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;

		const modelAttr = attrs.find((a: any) => a.key === "gen_ai.request.model");
		expect(modelAttr.value).toEqual({ stringValue: "gpt-4o" });

		const tokenAttr = attrs.find((a: any) => a.key === "gen_ai.usage.input_tokens");
		expect(tokenAttr.value).toEqual({ intValue: 100 });
	});

	it("uses custom endpoint", async () => {
		const exporter = new LangfuseExporter({
			publicKey: "pk",
			secretKey: "sk",
			endpoint: "http://localhost:3000",
		});

		await new Promise<void>((resolve) => {
			exporter.export([mockSpan()], () => resolve());
		});

		expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/api/public/otel/v1/traces");
	});

	it("reports failure on fetch error", async () => {
		fetchMock.mockRejectedValue(new Error("network error"));
		const exporter = new LangfuseExporter({ publicKey: "pk", secretKey: "sk" });

		const result = await new Promise<any>((resolve) => {
			exporter.export([mockSpan()], (r) => resolve(r));
		});

		expect(result.code).toBe(1); // FAILED
	});
});
