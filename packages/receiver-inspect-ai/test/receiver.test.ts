import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { InspectAIReceiver, parseEvalLog } from "../src/index.js";
import fixture from "./fixtures/eval-log.json";

describe("Inspect AI parser", () => {
	it("parses a valid eval log", () => {
		const log = parseEvalLog(fixture);
		expect(log.eval.run_id).toBe("inspect-run-001");
		expect(log.eval.task).toBe("coding-bench");
		expect(log.samples).toHaveLength(2);
	});

	it("throws on missing eval field", () => {
		expect(() => parseEvalLog({ samples: [] })).toThrow("missing eval field");
	});

	it("throws on non-object input", () => {
		expect(() => parseEvalLog(42)).toThrow("expected object");
	});
});

describe("InspectAIReceiver", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;
	let contextManager: AsyncHooksContextManager;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		contextManager = new AsyncHooksContextManager().enable();
		context.setGlobalContextManager(contextManager);
		provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
		trace.setGlobalTracerProvider(provider);
	});

	afterEach(async () => {
		await provider.shutdown();
		trace.disable();
		context.disable();
	});

	it("creates eval/run with sample and event children", () => {
		const receiver = new InspectAIReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		// 1 run + 2 samples + 3 events (sample1) + 2 events (sample2) = 8
		expect(spans).toHaveLength(8);

		const runSpan = spans.find((s) => s.name.startsWith("eval/run"));
		expect(runSpan).toBeDefined();
		expect(runSpan!.attributes["ho.eval.run_id"]).toBe("inspect-run-001");
	});

	it("creates model event spans with token usage", () => {
		const receiver = new InspectAIReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		const modelSpans = spans.filter((s) => s.name.startsWith("chat"));
		expect(modelSpans).toHaveLength(2);
		expect(modelSpans[0].attributes["gen_ai.usage.input_tokens"]).toBe(500);
		expect(modelSpans[0].attributes["gen_ai.usage.output_tokens"]).toBe(200);
	});

	it("creates tool event spans", () => {
		const receiver = new InspectAIReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		const toolSpans = spans.filter((s) => s.name.startsWith("tool/"));
		expect(toolSpans).toHaveLength(2);
		expect(toolSpans[0].attributes["gen_ai.tool.name"]).toBe("read_file");
	});

	it("sets error status on failed events", () => {
		const receiver = new InspectAIReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		const errorSpan = spans.find((s) => s.status.message === "Permission denied");
		expect(errorSpan).toBeDefined();
		expect(errorSpan!.status.code).toBe(2);
	});
});
