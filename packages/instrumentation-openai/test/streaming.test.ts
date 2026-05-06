import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenAIInstrumentation } from "../src/index.js";

function createMockStream(chunks: unknown[]) {
	let index = 0;
	return {
		[Symbol.asyncIterator]() {
			return {
				async next() {
					if (index < chunks.length) {
						return { value: chunks[index++], done: false };
					}
					return { value: undefined, done: true };
				},
			};
		},
	};
}

describe("OpenAIInstrumentation - Streaming", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;
	let instrumentation: OpenAIInstrumentation;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
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
	});

	it("wraps stream and captures TTFC and usage", async () => {
		const chunks = [
			{ choices: [{ delta: { content: "Hello" } }], model: "gpt-4o" },
			{ choices: [{ delta: { content: " world" } }], model: "gpt-4o" },
			{
				choices: [{ finish_reason: "stop", delta: {} }],
				model: "gpt-4o",
				usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
			},
		];

		const mockStreamCreate = async () => createMockStream(chunks);
		const patched = (instrumentation as any)._patchCreate()(mockStreamCreate);
		const stream = await patched.call({}, { model: "gpt-4o", stream: true });

		const collected: unknown[] = [];
		for await (const chunk of stream as AsyncIterable<unknown>) {
			collected.push(chunk);
		}

		expect(collected).toHaveLength(3);

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);

		const span = spans[0];
		expect(span.name).toBe("chat gpt-4o");
		expect(span.kind).toBe(SpanKind.CLIENT);
		expect(span.attributes["gen_ai.request.stream"]).toBe(true);
		expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(20);
		expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(10);
		expect(span.attributes["gen_ai.response.finish_reasons"]).toEqual(["stop"]);
		expect(span.attributes["gen_ai.response.model"]).toBe("gpt-4o");
		expect(span.attributes["gen_ai.response.time_to_first_chunk"]).toBeDefined();
		expect(span.attributes["gen_ai.response.time_to_first_chunk"]).toBeGreaterThan(0);
	});

	it("records error when stream throws", async () => {
		const errorStream = {
			[Symbol.asyncIterator]() {
				let called = false;
				return {
					async next() {
						if (!called) {
							called = true;
							return { value: { choices: [{ delta: { content: "Hi" } }] }, done: false };
						}
						throw new Error("stream interrupted");
					},
				};
			},
		};

		const mockStreamCreate = async () => errorStream;
		const patched = (instrumentation as any)._patchCreate()(mockStreamCreate);
		const stream = await patched.call({}, { model: "gpt-4o", stream: true });

		const chunks: unknown[] = [];
		try {
			for await (const chunk of stream as AsyncIterable<unknown>) {
				chunks.push(chunk);
			}
		} catch {
			// expected
		}

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].status.message).toBe("stream interrupted");
	});

	it("ends span only after iteration completes", async () => {
		const chunks = [
			{ choices: [{ delta: { content: "a" } }] },
			{ choices: [{ delta: { content: "b" } }] },
		];

		const mockStreamCreate = async () => createMockStream(chunks);
		const patched = (instrumentation as any)._patchCreate()(mockStreamCreate);
		const stream = await patched.call({}, { model: "gpt-4o", stream: true });

		expect(exporter.getFinishedSpans()).toHaveLength(0);

		for await (const _ of stream as AsyncIterable<unknown>) {
			// consume
		}

		expect(exporter.getFinishedSpans()).toHaveLength(1);
	});
});
