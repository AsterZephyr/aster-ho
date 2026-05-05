import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { DockerSandboxReceiver } from "../src/index.js";

describe("DockerSandboxReceiver", () => {
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

	it("creates a span from exec event", () => {
		const receiver = new DockerSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({ container_id: "abc123", command: "python test.py", exit_code: 0, duration_ms: 500, started_at: "2025-01-01T00:00:00Z", completed_at: "2025-01-01T00:00:01Z" });

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe("sandbox/exec python");
		expect(spans[0].attributes["ho.sandbox.type"]).toBe("docker");
		expect(spans[0].attributes["ho.sandbox.id"]).toBe("abc123");
	});

	it("sets error status on non-zero exit", () => {
		const receiver = new DockerSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({ container_id: "abc", command: "make build", exit_code: 2, duration_ms: 100, stderr: "build failed", started_at: "", completed_at: "" });

		const span = exporter.getFinishedSpans()[0];
		expect(span.status.code).toBe(2);
		expect(span.status.message).toBe("build failed");
	});

	it("filters by container", () => {
		const receiver = new DockerSandboxReceiver({ containerFilter: ["allowed-container"] });
		receiver.init(trace.getTracer("test"));

		receiver.ingest({ container_id: "blocked", command: "ls", exit_code: 0, duration_ms: 10, started_at: "", completed_at: "" });
		expect(exporter.getFinishedSpans()).toHaveLength(0);

		receiver.ingest({ container_id: "allowed-container", command: "ls", exit_code: 0, duration_ms: 10, started_at: "", completed_at: "" });
		expect(exporter.getFinishedSpans()).toHaveLength(1);
	});

	it("sets timed_out attribute", () => {
		const receiver = new DockerSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({ container_id: "x", command: "sleep 999", exit_code: 137, duration_ms: 30000, timed_out: true, started_at: "", completed_at: "" });

		const span = exporter.getFinishedSpans()[0];
		expect(span.attributes["ho.sandbox.timed_out"]).toBe(true);
	});

	it("uses remote parent context when trace_id provided", () => {
		const receiver = new DockerSandboxReceiver();
		receiver.init(trace.getTracer("test"));
		receiver.ingest({ container_id: "x", command: "echo hi", exit_code: 0, duration_ms: 5, trace_id: "aaaabbbbccccddddaaaabbbbccccdddd", span_id: "1122334455667788", started_at: "", completed_at: "" });

		const span = exporter.getFinishedSpans()[0];
		expect(span.spanContext().traceId).toBe("aaaabbbbccccddddaaaabbbbccccdddd");
		expect(span.parentSpanContext?.spanId).toBe("1122334455667788");
	});
});
