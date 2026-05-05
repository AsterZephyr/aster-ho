import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { METRReceiver, parseScoreLog } from "../src/index.js";
import fixture from "./fixtures/score-log.json";

describe("METR parser", () => {
	it("parses a valid score log", () => {
		const log = parseScoreLog(fixture);
		expect(log.task_id).toBe("reverse-hash");
		expect(log.run_id).toBe("metr-run-001");
		expect(log.score).toBe(0.75);
		expect(log.exec_results).toHaveLength(3);
	});

	it("throws on missing task_id", () => {
		expect(() => parseScoreLog({ run_id: "x" })).toThrow("missing task_id");
	});

	it("handles empty exec_results", () => {
		const log = parseScoreLog({ task_id: "t1", run_id: "r1", exec_results: [] });
		expect(log.exec_results).toHaveLength(0);
	});
});

describe("METRReceiver", () => {
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

	it("creates eval/run + score + exec spans", () => {
		const receiver = new METRReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		// 1 run + 1 score + 3 exec = 5
		expect(spans).toHaveLength(5);
	});

	it("score span has correct attributes", () => {
		const receiver = new METRReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		const scoreSpan = spans.find((s) => s.name === "eval/score");
		expect(scoreSpan).toBeDefined();
		expect(scoreSpan!.attributes["ho.eval.score"]).toBe(0.75);
		expect(scoreSpan!.attributes["ho.eval.max_score"]).toBe(1.0);
		expect(scoreSpan!.attributes["ho.eval.normalized_score"]).toBe(0.75);
	});

	it("sets error on non-zero exit code exec spans", () => {
		const receiver = new METRReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		const errorSpan = spans.find((s) => s.status.code === 2);
		expect(errorSpan).toBeDefined();
		expect(errorSpan!.attributes["ho.sandbox.exit_code"]).toBe(1);
	});

	it("adds intermediate score events to score span", () => {
		const receiver = new METRReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest(fixture);

		const spans = exporter.getFinishedSpans();
		const scoreSpan = spans.find((s) => s.name === "eval/score")!;
		expect(scoreSpan.events).toHaveLength(2);
		expect(scoreSpan.events[0].name).toBe("intermediate_score");
	});
});
