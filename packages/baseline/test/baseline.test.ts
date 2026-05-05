import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BaselineStore } from "../src/store.js";
import type { MetricEntry } from "../src/types.js";

function makeEntry(overrides: Partial<MetricEntry> = {}): MetricEntry {
	return {
		timestamp: Date.now(),
		traceId: "trace-001",
		model: "claude-3",
		tool: "bash",
		errorCategory: undefined,
		latencyMs: 100,
		inputTokens: 500,
		outputTokens: 200,
		costUsd: 0.01,
		...overrides,
	};
}

describe("BaselineStore", () => {
	let store: BaselineStore;

	beforeEach(() => {
		store = new BaselineStore({ dbPath: ":memory:" });
	});

	afterEach(() => {
		store.close();
	});

	it("records metric entry and retrieves it via baseline computation", () => {
		store.recordMetric(makeEntry({ latencyMs: 100 }));
		store.recordMetric(makeEntry({ latencyMs: 200 }));
		store.recomputeBaselines();

		const baseline = store.getBaseline({ model: "claude-3", tool: "bash" }, "latency_ms");
		expect(baseline).toBeDefined();
		expect(baseline!.count).toBe(2);
		expect(baseline!.mean).toBe(150);
	});

	it("computes correct mean and stddev", () => {
		store.recordMetric(makeEntry({ latencyMs: 10 }));
		store.recordMetric(makeEntry({ latencyMs: 20 }));
		store.recordMetric(makeEntry({ latencyMs: 30 }));
		store.recomputeBaselines();

		const baseline = store.getBaseline({ model: "claude-3", tool: "bash" }, "latency_ms");
		expect(baseline).toBeDefined();
		expect(baseline!.mean).toBe(20);
		// population stddev of [10, 20, 30] = sqrt(((10-20)^2 + (20-20)^2 + (30-20)^2) / 3) = sqrt(200/3) ~= 8.165
		expect(baseline!.stddev).toBeCloseTo(8.165, 2);
	});

	it("computes percentiles (p50, p95, p99) with 100 known values", () => {
		// Insert values 1 through 100
		for (let i = 1; i <= 100; i++) {
			store.recordMetric(makeEntry({ latencyMs: i }));
		}
		store.recomputeBaselines();

		const baseline = store.getBaseline({ model: "claude-3", tool: "bash" }, "latency_ms");
		expect(baseline).toBeDefined();
		expect(baseline!.p50).toBeCloseTo(50.5, 0);
		expect(baseline!.p95).toBeCloseTo(95.05, 0);
		expect(baseline!.p99).toBeCloseTo(99.01, 0);
	});

	it("detects anomaly when value exceeds threshold stddevs from mean", () => {
		for (let i = 0; i < 50; i++) {
			store.recordMetric(makeEntry({ latencyMs: 100 }));
		}
		store.recomputeBaselines();

		// All values are 100, stddev = 0 so zscore = 0 even for different values
		// Let's use a more spread out dataset
		store.close();
		store = new BaselineStore({ dbPath: ":memory:" });

		// mean=100, stddev=10 roughly
		const values = [80, 85, 90, 95, 100, 100, 105, 110, 115, 120];
		for (const v of values) {
			store.recordMetric(makeEntry({ latencyMs: v }));
		}
		store.recomputeBaselines();

		// value 200 should be highly anomalous (>3 stddevs)
		const result = store.isAnomaly({ model: "claude-3", tool: "bash" }, "latency_ms", 200, 3);
		expect(result.anomalous).toBe(true);
		expect(result.zscore).toBeGreaterThan(3);
	});

	it("returns non-anomalous when value is within threshold", () => {
		const values = [80, 85, 90, 95, 100, 100, 105, 110, 115, 120];
		for (const v of values) {
			store.recordMetric(makeEntry({ latencyMs: v }));
		}
		store.recomputeBaselines();

		// value 105 should be well within 3 stddevs
		const result = store.isAnomaly({ model: "claude-3", tool: "bash" }, "latency_ms", 105, 3);
		expect(result.anomalous).toBe(false);
		expect(result.zscore).toBeLessThan(3);
	});

	it("tracks unknown errors (record + getUnknownErrors)", () => {
		store.recordUnknownError({
			fingerprint: "fp-001",
			message: "Something went wrong",
			traceId: "trace-abc",
			model: "claude-3",
			tool: "bash",
			timestamp: 1000,
		});
		store.recordUnknownError({
			fingerprint: "fp-001",
			message: "Something went wrong",
			traceId: "trace-def",
			model: "claude-3",
			tool: "bash",
			timestamp: 2000,
		});

		const errors = store.getUnknownErrors();
		expect(errors).toHaveLength(1);
		expect(errors[0]!.fingerprint).toBe("fp-001");
		expect(errors[0]!.count).toBe(2);
		expect(errors[0]!.firstSeen).toBe(1000);
		expect(errors[0]!.lastSeen).toBe(2000);
	});

	it("marks error as ticketed (markTicketed + verify)", () => {
		store.recordUnknownError({
			fingerprint: "fp-002",
			message: "Error X",
			traceId: "trace-xyz",
			timestamp: 3000,
		});

		store.markTicketed("fp-002", "TICKET-123", "https://jira.example.com/TICKET-123");

		const errors = store.getUnknownErrors();
		expect(errors[0]!.ticketId).toBe("TICKET-123");
	});

	it("recompute baselines overwrites old values", () => {
		store.recordMetric(makeEntry({ latencyMs: 100 }));
		store.recomputeBaselines();

		const first = store.getBaseline({ model: "claude-3", tool: "bash" }, "latency_ms");
		expect(first!.mean).toBe(100);

		store.recordMetric(makeEntry({ latencyMs: 200 }));
		store.recomputeBaselines();

		const second = store.getBaseline({ model: "claude-3", tool: "bash" }, "latency_ms");
		expect(second!.mean).toBe(150);
		expect(second!.count).toBe(2);
	});

	it("empty baseline returns undefined", () => {
		const baseline = store.getBaseline({ model: "nonexistent", tool: "none" }, "latency_ms");
		expect(baseline).toBeUndefined();
	});
});
