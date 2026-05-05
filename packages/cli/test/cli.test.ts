import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadConfig, validateConfig } from "../src/config-loader.js";
import { validate } from "../src/validate.js";
import { replay } from "../src/replay.js";
import { buildExporters } from "../src/serve.js";
import { formatBaselines } from "../src/baseline.js";
import { parseTimeWindow, computeComparison, formatComparison } from "../src/compare.js";
import type { ComparisonResult } from "../src/compare.js";
import { buildSummary, formatReport } from "../src/report.js";
import { analyzeTrace, formatRootCause } from "../src/root-cause.js";

const fixtures = resolve(import.meta.dirname, "fixtures");

describe("config-loader", () => {
	it("loads valid YAML config", async () => {
		const config = await loadConfig(resolve(fixtures, "valid-config.yaml"));
		expect(config.service_name).toBe("my-agent");
		expect(config.enrichers).toEqual(["cost", "error-classify"]);
		expect(config.exporters?.file).toBeDefined();
		expect(config.exporters?.prometheus).toBeDefined();
	});

	it("throws on non-existent file", async () => {
		await expect(loadConfig("/nonexistent.yaml")).rejects.toThrow();
	});
});

describe("validateConfig", () => {
	it("returns valid for correct config", async () => {
		const config = await loadConfig(resolve(fixtures, "valid-config.yaml"));
		const result = validateConfig(config);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("returns errors for invalid config", async () => {
		const config = await loadConfig(resolve(fixtures, "invalid-config.yaml"));
		const result = validateConfig(config);
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors.some((e) => e.includes("enrichers must be an array"))).toBe(true);
		expect(result.errors.some((e) => e.includes("Unknown exporter"))).toBe(true);
	});
});

describe("validate command", () => {
	it("exits 0 for valid config", async () => {
		const result = await validate(resolve(fixtures, "valid-config.yaml"));
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Config valid");
	});

	it("exits 1 for invalid config", async () => {
		const result = await validate(resolve(fixtures, "invalid-config.yaml"));
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Config invalid");
	});

	it("exits 1 for missing file", async () => {
		const result = await validate("/nonexistent.yaml");
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Error:");
	});
});

describe("replay", () => {
	it("counts valid JSON lines in JSONL file", async () => {
		const result = await replay({ file: resolve(fixtures, "traces.jsonl") });
		expect(result.linesProcessed).toBe(3);
	});
});

describe("buildExporters", () => {
	it("builds file exporter from config", () => {
		const exporters = buildExporters({
			exporters: { file: { path: "./out.jsonl" } },
		});
		expect(exporters).toHaveLength(1);
	});

	it("builds prometheus exporter from config", () => {
		const exporters = buildExporters({
			exporters: { prometheus: { port: 9090 } },
		});
		expect(exporters).toHaveLength(1);
	});

	it("returns empty array when no exporters configured", () => {
		const exporters = buildExporters({});
		expect(exporters).toHaveLength(0);
	});
});

describe("validateConfig - context-rot enricher", () => {
	it("accepts context-rot as a valid enricher", () => {
		const result = validateConfig({
			service_name: "test",
			enrichers: ["cost", "error-classify", "context-rot"],
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});

describe("validateConfig - baseline and tickets sections", () => {
	it("accepts config with baseline and tickets sections", () => {
		const result = validateConfig({
			service_name: "test",
			enrichers: ["cost"],
			baseline: { db_path: "./baselines.db", retention_days: 30 },
			tickets: { provider: "github", github: { repo: "org/repo" } },
		} as any);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});

describe("baseline - formatBaselines", () => {
	it("returns JSON output for baselines", () => {
		const baselines = [
			{
				model: "gpt-4",
				tool: "search",
				metric: "latency_ms",
				stats: { count: 100, mean: 42.5, stddev: 15.7, p50: 40, p95: 120.3, p99: 200, lastUpdated: 1700000000000 },
			},
		];

		const output = formatBaselines(baselines, "json");
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].model).toBe("gpt-4");
		expect(parsed[0].stats.mean).toBe(42.5);
	});

	it("returns markdown table output for baselines", () => {
		const baselines = [
			{
				model: "claude-3",
				tool: "embed",
				metric: "cost_usd",
				stats: { count: 50, mean: 0.003, stddev: 0.001, p50: 0.0025, p95: 0.005, p99: 0.008, lastUpdated: 1700000000000 },
			},
		];

		const output = formatBaselines(baselines, "md");
		expect(output).toContain("| Model |");
		expect(output).toContain("claude-3");
		expect(output).toContain("cost_usd");
	});

	it("returns empty message for no baselines", () => {
		const output = formatBaselines([], "md");
		expect(output).toBe("No baselines found.");
	});
});

describe("compare - parseTimeWindow", () => {
	it("parses day windows", () => {
		expect(parseTimeWindow("7d")).toBe(7 * 24 * 60 * 60 * 1000);
	});

	it("parses hour windows", () => {
		expect(parseTimeWindow("24h")).toBe(24 * 60 * 60 * 1000);
	});

	it("parses minute windows", () => {
		expect(parseTimeWindow("30m")).toBe(30 * 60 * 1000);
	});

	it("throws on invalid format", () => {
		expect(() => parseTimeWindow("abc")).toThrow("Invalid time window");
	});
});

describe("compare - formatComparison", () => {
	it("produces MetricDiff structure in JSON", () => {
		const result: ComparisonResult = {
			metrics: {
				errorRate: { base: 0.05, compare: 0.08, delta: 0.03, deltaPercent: 60 },
				avgLatency: { base: 100, compare: 110, delta: 10, deltaPercent: 10 },
				avgCost: { base: 0.01, compare: 0.012, delta: 0.002, deltaPercent: 20 },
				avgInputTokens: { base: 500, compare: 550, delta: 50, deltaPercent: 10 },
			},
		};

		const output = formatComparison(result, "json");
		const parsed = JSON.parse(output);
		expect(parsed.metrics.errorRate.base).toBe(0.05);
		expect(parsed.metrics.errorRate.deltaPercent).toBe(60);
		expect(parsed.metrics.avgLatency.delta).toBe(10);
	});

	it("produces markdown table", () => {
		const result: ComparisonResult = {
			metrics: {
				errorRate: { base: 0.05, compare: 0.08, delta: 0.03, deltaPercent: 60 },
				avgLatency: { base: 100, compare: 110, delta: 10, deltaPercent: 10 },
				avgCost: { base: 0.01, compare: 0.012, delta: 0.002, deltaPercent: 20 },
				avgInputTokens: { base: 500, compare: 550, delta: 50, deltaPercent: 10 },
			},
		};

		const output = formatComparison(result, "md");
		expect(output).toContain("Error Rate");
		expect(output).toContain("Avg Latency");
	});
});

describe("report - formatReport", () => {
	it("generates markdown with error rate", () => {
		const summary = {
			periodStart: 1700000000000,
			periodEnd: 1700604800000,
			unknownErrorCount: 2,
			unknownErrors: [
				{ fingerprint: "fp1", count: 5, message: "Connection timeout" },
				{ fingerprint: "fp2", count: 3, message: "Rate limited" },
			],
			totalSpans: 1000,
			totalErrors: 50,
			errorRate: 0.05,
		};

		const output = formatReport(summary, "md");
		expect(output).toContain("Error Rate");
		expect(output).toContain("5.00%");
		expect(output).toContain("Connection timeout");
		expect(output).toContain("Rate limited");
		expect(output).toContain("1000");
	});

	it("generates JSON output", () => {
		const summary = {
			periodStart: 1700000000000,
			periodEnd: 1700604800000,
			unknownErrorCount: 0,
			unknownErrors: [],
			totalSpans: 100,
			totalErrors: 2,
			errorRate: 0.02,
		};

		const output = formatReport(summary, "json");
		const parsed = JSON.parse(output);
		expect(parsed.totalSpans).toBe(100);
		expect(parsed.errorRate).toBe(0.02);
	});
});

describe("root-cause - analyzeTrace", () => {
	it("finds trigger span from trace spans", () => {
		const spans = [
			{
				traceId: "trace-1",
				spanId: "span-1",
				name: "chat",
				startTimeUnixNano: 1000000,
				endTimeUnixNano: 2000000,
				attributes: { "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 50 },
			},
			{
				traceId: "trace-1",
				spanId: "span-2",
				name: "tool-call",
				startTimeUnixNano: 2000000,
				endTimeUnixNano: 3000000,
				status: { code: 2, message: "API timeout" },
				attributes: {},
			},
			{
				traceId: "trace-1",
				spanId: "span-3",
				name: "retry",
				startTimeUnixNano: 3000000,
				endTimeUnixNano: 4000000,
				status: { code: 2, message: "Cascade error" },
				attributes: { "gen_ai.usage.input_tokens": 200, "gen_ai.usage.output_tokens": 100 },
			},
			{
				traceId: "trace-1",
				spanId: "span-4",
				name: "fallback",
				startTimeUnixNano: 4000000,
				endTimeUnixNano: 5000000,
				attributes: { "gen_ai.usage.input_tokens": 150, "gen_ai.usage.output_tokens": 75 },
			},
		];

		const result = analyzeTrace("trace-1", spans);
		expect(result.traceId).toBe("trace-1");
		expect(result.triggerSpan).toBeDefined();
		expect(result.triggerSpan!.spanId).toBe("span-2");
		expect(result.triggerSpan!.name).toBe("tool-call");
		expect(result.triggerSpan!.error).toBe("API timeout");
		expect(result.cascadeSpans).toHaveLength(1);
		expect(result.cascadeSpans[0].spanId).toBe("span-3");
		expect(result.tokenWaste).toBe(525); // (200+100) + (150+75)
	});

	it("returns no trigger for healthy trace", () => {
		const spans = [
			{
				traceId: "trace-2",
				spanId: "span-1",
				name: "chat",
				startTimeUnixNano: 1000000,
				endTimeUnixNano: 2000000,
				attributes: {},
			},
		];

		const result = analyzeTrace("trace-2", spans);
		expect(result.triggerSpan).toBeUndefined();
		expect(result.cascadeSpans).toHaveLength(0);
		expect(result.tokenWaste).toBe(0);
	});

	it("formats root cause output", () => {
		const result = {
			traceId: "trace-1",
			triggerSpan: { spanId: "span-2", name: "tool-call", error: "API timeout" },
			cascadeSpans: [{ spanId: "span-3", name: "retry" }],
			tokenWaste: 525,
		};

		const output = formatRootCause(result);
		expect(output).toContain("Trace: trace-1");
		expect(output).toContain("Trigger: [span-2] tool-call");
		expect(output).toContain("API timeout");
		expect(output).toContain("Cascade spans: 1");
		expect(output).toContain("Token waste after trigger: 525");
	});
});
