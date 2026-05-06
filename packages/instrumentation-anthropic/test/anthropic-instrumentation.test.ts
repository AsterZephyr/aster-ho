import { SUPPRESS_INSTRUMENTATION_KEY } from "@ho/sdk";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnthropicInstrumentation } from "../src/index.js";

describe("AnthropicInstrumentation", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;
	let instrumentation: AnthropicInstrumentation;
	let contextManager: AsyncHooksContextManager;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		contextManager = new AsyncHooksContextManager().enable();
		context.setGlobalContextManager(contextManager);

		provider = new BasicTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		trace.setGlobalTracerProvider(provider);

		instrumentation = new AnthropicInstrumentation();
		instrumentation.setTracerProvider(provider);
	});

	afterEach(async () => {
		instrumentation.disable();
		await provider.shutdown();
		trace.disable();
		context.disable();
	});

	it("creates a span for non-streaming message", async () => {
		const mockCreate = async () => ({
			id: "msg_123",
			type: "message",
			model: "claude-sonnet-4-20250514",
			role: "assistant",
			content: [{ type: "text", text: "Hello!" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 12, output_tokens: 8 },
		});

		const patched = (instrumentation as any)._patchCreate()(mockCreate);
		await patched.call({}, { model: "claude-sonnet-4-20250514", messages: [] });

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0];
		expect(span.name).toBe("chat claude-sonnet-4-20250514");
		expect(span.kind).toBe(SpanKind.CLIENT);
		expect(span.attributes["gen_ai.operation.name"]).toBe("chat");
		expect(span.attributes["gen_ai.system"]).toBe("anthropic");
		expect(span.attributes["gen_ai.request.model"]).toBe("claude-sonnet-4-20250514");
		expect(span.attributes["gen_ai.response.model"]).toBe("claude-sonnet-4-20250514");
		expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(12);
		expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(8);
		expect(span.attributes["gen_ai.response.finish_reasons"]).toEqual(["end_turn"]);
	});

	it("records error status on failure", async () => {
		const failing = async () => {
			throw new Error("overloaded_error: too many requests");
		};

		const patched = (instrumentation as any)._patchCreate()(failing);

		await expect(patched.call({}, { model: "claude-sonnet-4-20250514" })).rejects.toThrow(
			"overloaded_error",
		);

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].status.message).toContain("overloaded_error");
	});

	it("skips instrumentation when suppress key is set", async () => {
		let called = false;
		const mockCreate = async () => {
			called = true;
			return { model: "claude-sonnet-4-20250514", usage: {}, stop_reason: "end_turn" };
		};

		const patched = (instrumentation as any)._patchCreate()(mockCreate);

		const suppressedCtx = context.active().setValue(SUPPRESS_INSTRUMENTATION_KEY, true);
		await context.with(suppressedCtx, () =>
			patched.call({}, { model: "claude-sonnet-4-20250514" }),
		);

		expect(called).toBe(true);
		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(0);
	});

	it("captures request attributes", async () => {
		const mockCreate = async () => ({
			model: "claude-sonnet-4-20250514",
			stop_reason: "end_turn",
			usage: { input_tokens: 5, output_tokens: 3 },
		});

		const patched = (instrumentation as any)._patchCreate()(mockCreate);
		await patched.call(
			{},
			{
				model: "claude-sonnet-4-20250514",
				temperature: 0.7,
				top_p: 0.95,
				max_tokens: 1024,
			},
		);

		const span = exporter.getFinishedSpans()[0];
		expect(span.attributes["gen_ai.request.temperature"]).toBe(0.7);
		expect(span.attributes["gen_ai.request.top_p"]).toBe(0.95);
		expect(span.attributes["gen_ai.request.max_tokens"]).toBe(1024);
	});

	it("captures cache usage tokens", async () => {
		const mockCreate = async () => ({
			model: "claude-sonnet-4-20250514",
			stop_reason: "end_turn",
			usage: {
				input_tokens: 100,
				output_tokens: 50,
				cache_read_input_tokens: 80,
				cache_creation_input_tokens: 20,
			},
		});

		const patched = (instrumentation as any)._patchCreate()(mockCreate);
		await patched.call({}, { model: "claude-sonnet-4-20250514", messages: [] });

		const span = exporter.getFinishedSpans()[0];
		expect(span.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(80);
		expect(span.attributes["gen_ai.usage.cache_creation.input_tokens"]).toBe(20);
	});
});
