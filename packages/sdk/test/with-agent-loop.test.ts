import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentLoopMaxIterationsError, AgentLoopTimeoutError, withAgentLoop } from "../src/index.js";

describe("withAgentLoop", () => {
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

	it("creates root invoke_agent span with agent name", async () => {
		await withAgentLoop("test-agent", async (loop) => {
			loop.finish("done");
		});

		const spans = exporter.getFinishedSpans();
		const root = spans.find((s) => s.name === "invoke_agent test-agent");
		expect(root).toBeDefined();
		expect(root?.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
		expect(root?.attributes["gen_ai.agent.name"]).toBe("test-agent");
	});

	it("creates flat sibling tool spans under root", async () => {
		await withAgentLoop("agent", async (loop) => {
			loop.iteration++;
			await loop.traceTool("read_file", async () => "content");
			await loop.traceTool("write_file", async () => "ok");
			loop.finish("done");
		});

		const spans = exporter.getFinishedSpans();
		const root = spans.find((s) => s.name.startsWith("invoke_agent"))!;
		const tools = spans.filter((s) => s.name.startsWith("execute_tool"));

		expect(tools).toHaveLength(2);
		for (const tool of tools) {
			expect(tool.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
		}
	});

	it("records iteration count on span", async () => {
		await withAgentLoop("agent", async (loop) => {
			loop.iteration++;
			loop.iteration++;
			loop.iteration++;
			loop.finish("result");
		});

		const root = exporter.getFinishedSpans().find((s) => s.name.startsWith("invoke_agent"))!;
		expect(root.attributes["ho.agent.iterations"]).toBe(3);
	});

	it("throws AgentLoopMaxIterationsError when limit exceeded", async () => {
		await expect(
			withAgentLoop(
				"agent",
				async (loop) => {
					loop.iteration = 5;
					await loop.traceTool("tool", async () => "x");
				},
				{ maxIterations: 5 },
			),
		).rejects.toThrow(AgentLoopMaxIterationsError);

		const root = exporter.getFinishedSpans().find((s) => s.name.startsWith("invoke_agent"))!;
		expect(root.status.code).toBe(SpanStatusCode.ERROR);
	});

	it("throws AgentLoopTimeoutError on timeout", async () => {
		await expect(
			withAgentLoop(
				"slow-agent",
				async (loop) => {
					await new Promise((r) => setTimeout(r, 100));
					await loop.traceTool("tool", async () => "x");
				},
				{ timeout: 50 },
			),
		).rejects.toThrow(AgentLoopTimeoutError);
	});

	it("records error on user function throw", async () => {
		await expect(
			withAgentLoop("agent", async () => {
				throw new Error("user error");
			}),
		).rejects.toThrow("user error");

		const root = exporter.getFinishedSpans().find((s) => s.name.startsWith("invoke_agent"))!;
		expect(root.status.code).toBe(SpanStatusCode.ERROR);
		expect(root.status.message).toBe("user error");
	});
});
