import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { AnthropicInstrumentation } from "../src/index.js";

async function* makeStreamEvents(events: unknown[]) {
	for (const event of events) {
		yield event;
	}
}

describe("AnthropicInstrumentation streaming", () => {
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

	it("wraps streaming response and captures token usage", async () => {
		const events = [
			{ type: "message_start", message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 15 } } },
			{ type: "content_block_start", content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
			{ type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } },
			{ type: "message_stop" },
		];

		const mockCreate = async () => makeStreamEvents(events);
		const patched = (instrumentation as any)._patchCreate()(mockCreate);

		const stream = await patched.call({}, { model: "claude-sonnet-4-20250514", stream: true });

		const collected: unknown[] = [];
		for await (const chunk of stream) {
			collected.push(chunk);
		}

		expect(collected).toHaveLength(6);

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0];
		expect(span.attributes["gen_ai.request.stream"]).toBe(true);
		expect(span.attributes["gen_ai.response.model"]).toBe("claude-sonnet-4-20250514");
		expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(15);
		expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(10);
		expect(span.attributes["gen_ai.response.finish_reasons"]).toEqual(["end_turn"]);
	});

	it("records time to first chunk", async () => {
		const events = [
			{ type: "message_start", message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 5 } } },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
			{ type: "message_stop" },
		];

		const mockCreate = async () => makeStreamEvents(events);
		const patched = (instrumentation as any)._patchCreate()(mockCreate);

		const stream = await patched.call({}, { model: "claude-sonnet-4-20250514", stream: true });
		for await (const _ of stream) {}

		const span = exporter.getFinishedSpans()[0];
		expect(span.attributes["gen_ai.response.time_to_first_chunk"]).toBeTypeOf("number");
		expect(span.attributes["gen_ai.response.time_to_first_chunk"] as number).toBeGreaterThanOrEqual(0);
	});

	it("records error on stream failure", async () => {
		async function* failingStream() {
			yield { type: "message_start", message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 5 } } };
			throw new Error("connection reset");
		}

		const mockCreate = async () => failingStream();
		const patched = (instrumentation as any)._patchCreate()(mockCreate);

		const stream = await patched.call({}, { model: "claude-sonnet-4-20250514", stream: true });

		const collected: unknown[] = [];
		await expect(async () => {
			for await (const chunk of stream) {
				collected.push(chunk);
			}
		}).rejects.toThrow("connection reset");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].status.message).toBe("connection reset");
	});
});
