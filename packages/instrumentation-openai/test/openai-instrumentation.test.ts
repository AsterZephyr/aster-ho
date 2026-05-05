import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OpenAIInstrumentation } from "../src/index.js";
import { SUPPRESS_INSTRUMENTATION_KEY } from "@ho/sdk";

describe("OpenAIInstrumentation", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;
	let instrumentation: OpenAIInstrumentation;
	let contextManager: AsyncHooksContextManager;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		contextManager = new AsyncHooksContextManager().enable();
		context.setGlobalContextManager(contextManager);

		provider = new BasicTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		trace.setGlobalTracerProvider(provider);

		instrumentation = new OpenAIInstrumentation();
		instrumentation.setTracerProvider(provider);
	});

	afterEach(async () => {
		instrumentation.disable();
		await provider.shutdown();
		trace.disable();
		context.disable();
	});

	it("creates a span for non-streaming chat completion", async () => {
		const mockCreate = async () => ({
			id: "chatcmpl-123",
			model: "gpt-4o",
			choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hello!" } }],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		});

		const patched = (instrumentation as any)._patchCreate()(mockCreate);
		await patched.call({}, { model: "gpt-4o", messages: [] });

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0];
		expect(span.name).toBe("chat gpt-4o");
		expect(span.kind).toBe(SpanKind.CLIENT);
		expect(span.attributes["gen_ai.operation.name"]).toBe("chat");
		expect(span.attributes["gen_ai.request.model"]).toBe("gpt-4o");
		expect(span.attributes["gen_ai.response.model"]).toBe("gpt-4o");
		expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(10);
		expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(5);
		expect(span.attributes["gen_ai.response.finish_reasons"]).toEqual(["stop"]);
	});

	it("records error status on failure", async () => {
		const failing = async () => {
			throw new Error("rate limit exceeded");
		};

		const patched = (instrumentation as any)._patchCreate()(failing);

		await expect(patched.call({}, { model: "gpt-4o" })).rejects.toThrow("rate limit exceeded");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].status.message).toBe("rate limit exceeded");
	});

	it("skips instrumentation when suppress key is set", async () => {
		let called = false;
		const mockCreate = async () => {
			called = true;
			return { model: "gpt-4o", choices: [], usage: {} };
		};

		const patched = (instrumentation as any)._patchCreate()(mockCreate);

		const suppressedCtx = context.active().setValue(SUPPRESS_INSTRUMENTATION_KEY, true);
		await context.with(suppressedCtx, () => patched.call({}, { model: "gpt-4o" }));

		expect(called).toBe(true);
		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(0);
	});

	it("captures request attributes (temperature, top_p, max_tokens)", async () => {
		const mockCreate = async () => ({
			model: "gpt-4o",
			choices: [{ finish_reason: "stop" }],
			usage: { prompt_tokens: 5, completion_tokens: 3 },
		});

		const patched = (instrumentation as any)._patchCreate()(mockCreate);
		await patched.call({}, {
			model: "gpt-4o",
			temperature: 0.7,
			top_p: 0.9,
			max_tokens: 100,
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.attributes["gen_ai.request.temperature"]).toBe(0.7);
		expect(span.attributes["gen_ai.request.top_p"]).toBe(0.9);
		expect(span.attributes["gen_ai.request.max_tokens"]).toBe(100);
	});
});
