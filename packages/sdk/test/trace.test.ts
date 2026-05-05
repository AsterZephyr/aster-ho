import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { hoTrace } from "../src/index.js";

describe("@hoTrace decorator", () => {
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

	it("creates a span with the method name", async () => {
		class MyService {
			@hoTrace()
			async fetchData() {
				return "data";
			}
		}

		const svc = new MyService();
		const result = await svc.fetchData();

		expect(result).toBe("data");
		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe("fetchData");
	});

	it("uses custom name when provided", async () => {
		class MyService {
			@hoTrace({ name: "custom.operation" })
			async doWork() {
				return 1;
			}
		}

		const svc = new MyService();
		await svc.doWork();

		const spans = exporter.getFinishedSpans();
		expect(spans[0].name).toBe("custom.operation");
	});

	it("records error on exception", async () => {
		class MyService {
			@hoTrace()
			async failingOp() {
				throw new Error("service error");
			}
		}

		const svc = new MyService();
		await expect(svc.failingOp()).rejects.toThrow("service error");

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0].status.message).toBe("service error");
	});
});
