import type { BaselineStats } from "@ho/baseline";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import {
	Aggregator,
	PrometheusExporter,
	convertSpans,
	generateRecordingRules,
} from "../src/index.js";

function mockSpan(
	overrides: Partial<{
		name: string;
		attributes: Record<string, unknown>;
		statusCode: number;
		startTime: [number, number];
		endTime: [number, number];
	}> = {},
): ReadableSpan {
	return {
		name: overrides.name ?? "test",
		kind: SpanKind.CLIENT,
		status: { code: overrides.statusCode ?? SpanStatusCode.OK },
		startTime: overrides.startTime ?? [1700000000, 0],
		endTime: overrides.endTime ?? [1700000001, 0],
		attributes: overrides.attributes ?? {},
		events: [],
		spanContext: () => ({ traceId: "a", spanId: "b", traceFlags: 1 }),
	} as unknown as ReadableSpan;
}

describe("Connector", () => {
	it("extracts span_duration metric", () => {
		const spans = [mockSpan({ startTime: [100, 0], endTime: [102, 500000000] })];
		const samples = convertSpans(
			spans,
			[{ name: "call_duration", type: "histogram", source: "span_duration" }],
			[],
		);
		expect(samples).toHaveLength(1);
		expect(samples[0].value).toBeCloseTo(2.5);
	});

	it("extracts token metrics", () => {
		const spans = [
			mockSpan({
				attributes: { "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 50 },
			}),
		];
		const samples = convertSpans(
			spans,
			[
				{ name: "input_tok", type: "counter", source: "input_tokens" },
				{ name: "output_tok", type: "counter", source: "output_tokens" },
			],
			[],
		);
		expect(samples).toHaveLength(2);
		expect(samples[0].value).toBe(100);
		expect(samples[1].value).toBe(50);
	});

	it("applies filter", () => {
		const spans = [
			mockSpan({ attributes: { "gen_ai.request.model": "gpt-4" } }),
			mockSpan({ attributes: { "gen_ai.request.model": "claude" } }),
		];
		const samples = convertSpans(
			spans,
			[
				{
					name: "count",
					type: "counter",
					source: "span_count",
					filter: { "gen_ai.request.model": "gpt-4" },
				},
			],
			[],
		);
		expect(samples).toHaveLength(1);
	});

	it("extracts dimension labels", () => {
		const spans = [mockSpan({ attributes: { "gen_ai.request.model": "gpt-4" } })];
		const samples = convertSpans(
			spans,
			[{ name: "count", type: "counter", source: "span_count" }],
			["gen_ai.request.model"],
		);
		expect(samples[0].labels).toEqual({ gen_ai_request_model: "gpt-4" });
	});
});

describe("Aggregator", () => {
	it("accumulates counters", () => {
		const agg = new Aggregator();
		agg.push([{ name: "requests", type: "counter", value: 1, labels: {} }]);
		agg.push([{ name: "requests", type: "counter", value: 1, labels: {} }]);

		const output = agg.serialize("ho_");
		expect(output).toContain("ho_requests_total 2");
	});

	it("builds histogram buckets", () => {
		const agg = new Aggregator();
		agg.configureBuckets("duration", [0.1, 0.5, 1.0]);
		agg.push([{ name: "duration", type: "histogram", value: 0.3, labels: {} }]);

		const output = agg.serialize("ho_");
		expect(output).toContain('ho_duration_bucket{le="0.5"} 1');
		expect(output).toContain('ho_duration_bucket{le="0.1"} 0');
		expect(output).toContain("ho_duration_sum 0.3");
		expect(output).toContain("ho_duration_count 1");
	});
});

describe("PrometheusExporter", () => {
	let exporter: PrometheusExporter;

	afterEach(async () => {
		await exporter?.shutdown();
	});

	it("exports spans and produces metrics output", () => {
		exporter = new PrometheusExporter({
			metrics: [{ name: "llm_calls", type: "counter", source: "span_count" }],
		});

		const result = { code: -1 };
		exporter.export([mockSpan()], (r) => {
			result.code = r.code;
		});
		expect(result.code).toBe(ExportResultCode.SUCCESS);

		const output = exporter.getMetricsOutput();
		expect(output).toContain("ho_llm_calls_total 1");
	});

	it("serves /metrics endpoint", async () => {
		exporter = new PrometheusExporter({
			port: 0, // random port
			metrics: [{ name: "test_metric", type: "counter", source: "span_count" }],
		});

		exporter.export([mockSpan()], () => {});
		await exporter.start();

		const addr = (exporter as any).server.address();
		const res = await fetch(`http://localhost:${addr.port}/metrics`);
		const text = await res.text();

		expect(res.status).toBe(200);
		expect(text).toContain("ho_test_metric_total 1");
	});
});

describe("Recording Rules", () => {
	it("generates valid YAML structure", () => {
		const baselines: Array<{ model: string; tool: string; metric: string; stats: BaselineStats }> =
			[
				{
					model: "gpt-4",
					tool: "search",
					metric: "latency_ms",
					stats: {
						count: 100,
						mean: 42.5,
						stddev: 15.7,
						p50: 40,
						p95: 120.3,
						p99: 200,
						lastUpdated: Date.now(),
					},
				},
			];

		const yaml = generateRecordingRules(baselines);
		expect(yaml).toContain("groups:");
		expect(yaml).toContain("name: ho_baselines");
		expect(yaml).toContain("interval: 1m");
		expect(yaml).toContain('record: ho:latency_ms:mean{model="gpt-4",tool="search"}');
		expect(yaml).toContain("expr: 42.5");
		expect(yaml).toContain('record: ho:latency_ms:p95{model="gpt-4",tool="search"}');
		expect(yaml).toContain("expr: 120.3");
		expect(yaml).toContain('record: ho:latency_ms:stddev{model="gpt-4",tool="search"}');
		expect(yaml).toContain("expr: 15.7");
	});

	it("respects custom prefix", () => {
		const baselines: Array<{ model: string; tool: string; metric: string; stats: BaselineStats }> =
			[
				{
					model: "claude-3",
					tool: "embed",
					metric: "cost_usd",
					stats: {
						count: 50,
						mean: 0.003,
						stddev: 0.001,
						p50: 0.0025,
						p95: 0.005,
						p99: 0.008,
						lastUpdated: Date.now(),
					},
				},
			];

		const yaml = generateRecordingRules(baselines, { prefix: "myapp", evaluation_interval: "5m" });
		expect(yaml).toContain("name: myapp_baselines");
		expect(yaml).toContain("interval: 5m");
		expect(yaml).toContain('record: myapp:cost_usd:mean{model="claude-3",tool="embed"}');
	});
});

describe("Connector - context_rot_count", () => {
	it("extracts context_rot_count from spans with rot attribute", () => {
		const spans = [
			mockSpan({ attributes: { "ho.context_rot.type": "token_bloat" } }),
			mockSpan({ attributes: { "ho.context_rot.type": "cascade_failure" } }),
			mockSpan({ attributes: {} }),
		];

		const samples = convertSpans(
			spans,
			[{ name: "rot_events", type: "counter", source: "context_rot_count" }],
			[],
		);

		expect(samples).toHaveLength(2);
		expect(samples[0].value).toBe(1);
		expect(samples[0].labels).toEqual({ rot_type: "token_bloat" });
		expect(samples[1].labels).toEqual({ rot_type: "cascade_failure" });
	});
});
