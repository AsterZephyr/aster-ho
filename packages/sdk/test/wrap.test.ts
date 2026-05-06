import { context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SUPPRESS_INSTRUMENTATION_KEY, wrapLLMCall } from "../src/index.js";

describe("wrapLLMCall", () => {
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

	it("creates a span with model name", async () => {
		const fn = async (prompt: string) => `response to: ${prompt}`;
		const wrapped = wrapLLMCall(fn, { provider: "custom", model: "my-model" });

		const result = await wrapped("hello");
		expect(result).toBe("response to: hello");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe("chat my-model");
		expect(spans[0].attributes["gen_ai.operation.name"]).toBe("chat");
		expect(spans[0].attributes["gen_ai.provider.name"]).toBe("custom");
		expect(spans[0].attributes["gen_ai.request.model"]).toBe("my-model");
	});

	it("sets SUPPRESS_INSTRUMENTATION_KEY in context during execution", async () => {
		let suppressValue: unknown;
		const fn = async () => {
			suppressValue = context.active().getValue(SUPPRESS_INSTRUMENTATION_KEY);
			return "ok";
		};

		const wrapped = wrapLLMCall(fn, { provider: "test" });
		await wrapped();

		expect(suppressValue).toBe(true);
	});

	it("suppress key is not set outside the wrapped call", async () => {
		const fn = async () => "ok";
		const wrapped = wrapLLMCall(fn, { provider: "test" });
		await wrapped();

		const afterValue = context.active().getValue(SUPPRESS_INSTRUMENTATION_KEY);
		expect(afterValue).toBeUndefined();
	});

	it("records error on exception", async () => {
		const fn = async () => {
			throw new Error("LLM failure");
		};

		const wrapped = wrapLLMCall(fn, { provider: "test", model: "broken" });
		await expect(wrapped()).rejects.toThrow("LLM failure");

		const spans = exporter.getFinishedSpans();
		expect(spans[0].status.message).toBe("LLM failure");
	});
});
