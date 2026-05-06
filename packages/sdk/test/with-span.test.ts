import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withSpan } from "../src/index.js";

describe("withSpan", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		const contextManager = new AsyncHooksContextManager().enable();
		context.setGlobalContextManager(contextManager);
		provider = new BasicTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		trace.setGlobalTracerProvider(provider);
	});

	afterEach(async () => {
		await provider.shutdown();
		trace.disable();
		context.disable();
	});

	it("creates a span with the given name", async () => {
		await withSpan("test-span", async () => "result");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe("test-span");
	});

	it("returns the function result", async () => {
		const result = await withSpan("calc", async () => 42);
		expect(result).toBe(42);
	});

	it("records error status on exception", async () => {
		await expect(
			withSpan("fail", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].status.message).toBe("boom");
	});

	it("provides the span to the callback", async () => {
		await withSpan("custom", async (span) => {
			span.setAttribute("custom.attr", "value");
		});

		const spans = exporter.getFinishedSpans();
		expect(spans[0].attributes["custom.attr"]).toBe("value");
	});

	it("nests spans correctly via context propagation", async () => {
		await withSpan("parent", async () => {
			await withSpan("child", async () => "inner");
		});

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(2);
		const child = spans.find((s) => s.name === "child")!;
		const parent = spans.find((s) => s.name === "parent")!;
		expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
	});
});
