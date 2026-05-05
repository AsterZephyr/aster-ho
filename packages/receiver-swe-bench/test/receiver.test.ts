import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SWEBenchReceiver, parseReport } from "../src/index.js";
import fixture from "./fixtures/report.json";

describe("SWE-bench parser", () => {
	it("parses a valid report", () => {
		const report = parseReport(fixture);
		expect(report.run_id).toBe("run-2025-01-15");
		expect(report.model).toBe("claude-sonnet-4-20250514");
		expect(report.dataset).toBe("swe-bench-lite");
		expect(report.instances).toHaveLength(3);
	});

	it("throws on non-object input", () => {
		expect(() => parseReport(null)).toThrow("expected object");
		expect(() => parseReport("string")).toThrow("expected object");
	});

	it("throws on missing run_id", () => {
		expect(() => parseReport({ model: "x" })).toThrow("missing run_id");
	});

	it("handles empty instances array", () => {
		const report = parseReport({ run_id: "r1", model: "m1", instances: [] });
		expect(report.instances).toHaveLength(0);
	});
});

describe("SWEBenchReceiver", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;
	let contextManager: AsyncHooksContextManager;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		contextManager = new AsyncHooksContextManager().enable();
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

	it("creates eval/run span with sample children", () => {
		const receiver = new SWEBenchReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBe(4); // 1 run + 3 samples

		const runSpan = spans.find((s) => s.name.startsWith("eval/run"));
		expect(runSpan).toBeDefined();
		expect(runSpan!.attributes["ho.eval.run_id"]).toBe("run-2025-01-15");
		expect(runSpan!.attributes["ho.eval.total_samples"]).toBe(3);
		expect(runSpan!.attributes["ho.eval.resolved_count"]).toBe(1);
	});

	it("sets parent-child relationship between run and samples", () => {
		const receiver = new SWEBenchReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		const runSpan = spans.find((s) => s.name.startsWith("eval/run"))!;
		const sampleSpans = spans.filter((s) => s.name.startsWith("eval/sample"));

		for (const sample of sampleSpans) {
			expect(sample.parentSpanContext?.spanId).toBe(runSpan.spanContext().spanId);
		}
	});

	it("sets error status on failed instances", () => {
		const receiver = new SWEBenchReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		const failedSpan = spans.find((s) => s.name.includes("flask__flask-6789"));
		expect(failedSpan).toBeDefined();
		expect(failedSpan!.status.code).toBe(2); // ERROR
		expect(failedSpan!.status.message).toBe("Tests failed after patch");
	});

	it("throws if not initialized", () => {
		const receiver = new SWEBenchReceiver();
		expect(() => receiver.ingest(fixture)).toThrow("not initialized");
	});
});
