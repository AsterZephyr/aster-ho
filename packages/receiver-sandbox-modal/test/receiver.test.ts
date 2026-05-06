import { context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModalSandboxReceiver } from "../src/index.js";

describe("ModalSandboxReceiver", () => {
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
		const receiver = new ModalSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({
			container_id: "ctr-1",
			function_name: "solve",
			action: "exec",
			command: "python run.py",
			exit_code: 0,
			duration_ms: 5000,
			started_at: "",
			completed_at: "",
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.name).toBe("sandbox/exec python");
		expect(span.attributes["ho.sandbox.type"]).toBe("modal");
		expect(span.attributes["ho.sandbox.function_name"]).toBe("solve");
	});

	it("creates span for terminate event", () => {
		const receiver = new ModalSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({
			container_id: "ctr-2",
			function_name: "worker",
			action: "terminate",
			duration_ms: 0,
			started_at: "",
			completed_at: "",
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.name).toBe("sandbox/terminate worker");
		expect(span.attributes["gen_ai.tool.name"]).toBe("sandbox.terminate");
	});

	it("sets error on failure", () => {
		const receiver = new ModalSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({
			container_id: "ctr-3",
			function_name: "run",
			action: "exec",
			command: "x",
			exit_code: 1,
			duration_ms: 100,
			error: "OOM killed",
			started_at: "",
			completed_at: "",
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.status.code).toBe(2);
		expect(span.status.message).toBe("OOM killed");
	});

	it("includes function_name attribute", () => {
		const receiver = new ModalSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({
			container_id: "ctr-4",
			function_name: "my_function",
			action: "spawn",
			duration_ms: 200,
			started_at: "",
			completed_at: "",
		});

		const span = exporter.getFinishedSpans()[0];
		expect(span.attributes["ho.sandbox.function_name"]).toBe("my_function");
	});

	it("throws on missing container_id", () => {
		const receiver = new ModalSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		expect(() => receiver.ingest({} as any)).toThrow("missing container_id");
	});
});
