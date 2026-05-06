import { context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { E2BSandboxReceiver } from "../src/index.js";

describe("E2BSandboxReceiver", () => {
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

	it("creates span for exec event", () => {
		const receiver = new E2BSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({
			sandbox_id: "sbx-1",
			action: "exec",
			command: "npm test",
			exit_code: 0,
			duration_ms: 3000,
			started_at: "",
			completed_at: "",
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.name).toBe("sandbox/exec npm");
		expect(span.attributes["gen_ai.tool.name"]).toBe("sandbox.exec");
		expect(span.attributes["ho.sandbox.type"]).toBe("e2b");
	});

	it("creates span for file operations", () => {
		const receiver = new E2BSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({
			sandbox_id: "sbx-1",
			action: "write_file",
			path: "/app/main.py",
			duration_ms: 50,
			started_at: "",
			completed_at: "",
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.name).toBe("sandbox/write_file /app/main.py");
		expect(span.attributes["gen_ai.tool.name"]).toBe("sandbox.write_file");
	});

	it("sets error on failed exec", () => {
		const receiver = new E2BSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({
			sandbox_id: "sbx-1",
			action: "exec",
			command: "make",
			exit_code: 1,
			duration_ms: 100,
			started_at: "",
			completed_at: "",
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.status.code).toBe(2);
	});

	it("sets error from error field", () => {
		const receiver = new E2BSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({
			sandbox_id: "sbx-1",
			action: "exec",
			command: "x",
			duration_ms: 0,
			error: "Sandbox timeout",
			started_at: "",
			completed_at: "",
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.status.message).toBe("Sandbox timeout");
	});

	it("includes duration_ms attribute", () => {
		const receiver = new E2BSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({
			sandbox_id: "sbx-2",
			action: "exec",
			command: "ls",
			exit_code: 0,
			duration_ms: 42,
			started_at: "",
			completed_at: "",
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.attributes["ho.sandbox.duration_ms"]).toBe(42);
	});
});
