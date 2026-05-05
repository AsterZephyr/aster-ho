import { describe, expect, it, vi } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { AlertProcessor, ConsoleNotifier, createWindow, pushMetric, getMetricValue, evaluateAnomaly } from "../src/index.js";
import type { AnomalyCondition, AlertNotifier, AlertEvent } from "../src/index.js";
import { TicketNotifier } from "../src/ticket-notifier.js";
import type { TicketProvider, TicketRequest, TicketResult } from "@ho/ticket-provider";
import type { BaselineStore, BaselineKey, AnomalyResult } from "@ho/baseline";

function mockSpan(overrides: Partial<{ statusCode: number; startTime: [number, number]; endTime: [number, number]; attributes: Record<string, unknown> }> = {}): ReadableSpan {
	return {
		status: { code: overrides.statusCode ?? SpanStatusCode.OK },
		startTime: overrides.startTime ?? [1700000000, 0],
		endTime: overrides.endTime ?? [1700000001, 0],
		attributes: overrides.attributes ?? {},
		events: [],
		spanContext: () => ({ traceId: "a", spanId: "b", traceFlags: 1 }),
	} as unknown as ReadableSpan;
}

describe("SlidingWindow", () => {
	it("accumulates metrics", () => {
		let w = createWindow(60000);
		w = pushMetric(w, 1000, { isError: false, latencyMs: 100, costUsd: 0.01 });
		w = pushMetric(w, 1100, { isError: true, latencyMs: 200, costUsd: 0.02 });

		expect(getMetricValue(w, "span_count")).toBe(2);
		expect(getMetricValue(w, "error_rate")).toBe(0.5);
		expect(getMetricValue(w, "latency_avg")).toBe(150);
		expect(getMetricValue(w, "cost_total")).toBeCloseTo(0.03);
	});

	it("expires old buckets", () => {
		let w = createWindow(1000); // 1s window
		w = pushMetric(w, 100, { isError: false, latencyMs: 50, costUsd: 0 });
		w = pushMetric(w, 1200, { isError: false, latencyMs: 50, costUsd: 0 });

		// First bucket at time 100 should be expired (cutoff = 1200 - 1000 = 200)
		expect(getMetricValue(w, "span_count")).toBe(1);
	});
});

describe("AlertProcessor", () => {
	it("fires alert when error_rate exceeds threshold", () => {
		const notifier = new ConsoleNotifier();
		const processor = new AlertProcessor({
			rules: [{
				name: "high-errors",
				condition: { metric: "error_rate", operator: "gt", threshold: 0.5 },
				windowMs: 60000,
				notifiers: [notifier],
			}],
		});

		// 3 errors out of 4 spans = 75% error rate
		processor.enrich(mockSpan({ statusCode: SpanStatusCode.ERROR }), {});
		processor.enrich(mockSpan({ statusCode: SpanStatusCode.ERROR }), {});
		processor.enrich(mockSpan({ statusCode: SpanStatusCode.ERROR }), {});
		processor.enrich(mockSpan({ statusCode: SpanStatusCode.OK }), {});

		expect(notifier.events.length).toBeGreaterThan(0);
		expect(notifier.events[0].rule).toBe("high-errors");
	});

	it("does not fire when below threshold", () => {
		const notifier = new ConsoleNotifier();
		const processor = new AlertProcessor({
			rules: [{
				name: "high-errors",
				condition: { metric: "error_rate", operator: "gt", threshold: 0.9 },
				windowMs: 60000,
				notifiers: [notifier],
			}],
		});

		processor.enrich(mockSpan({ statusCode: SpanStatusCode.OK }), {});
		processor.enrich(mockSpan({ statusCode: SpanStatusCode.OK }), {});

		expect(notifier.events).toHaveLength(0);
	});

	it("respects cooldown", () => {
		const notifier = new ConsoleNotifier();
		const processor = new AlertProcessor({
			rules: [{
				name: "rate-alert",
				condition: { metric: "error_rate", operator: "gte", threshold: 0 },
				windowMs: 60000,
				cooldownMs: 999999999, // very long cooldown
				notifiers: [notifier],
			}],
		});

		processor.enrich(mockSpan({ statusCode: SpanStatusCode.ERROR }), {});
		processor.enrich(mockSpan({ statusCode: SpanStatusCode.ERROR }), {});
		processor.enrich(mockSpan({ statusCode: SpanStatusCode.ERROR }), {});

		// Only first should fire due to long cooldown
		expect(notifier.events).toHaveLength(1);
	});

	it("respects attribute filter", () => {
		const notifier = new ConsoleNotifier();
		const processor = new AlertProcessor({
			rules: [{
				name: "filtered",
				condition: { metric: "span_count", operator: "gte", threshold: 1, filter: { "gen_ai.request.model": "gpt-4" } },
				windowMs: 60000,
				notifiers: [notifier],
			}],
		});

		processor.enrich(mockSpan({ attributes: { "gen_ai.request.model": "claude" } }), {});
		expect(notifier.events).toHaveLength(0);

		processor.enrich(mockSpan({ attributes: { "gen_ai.request.model": "gpt-4" } }), {});
		expect(notifier.events).toHaveLength(1);
	});

	it("returns attrs unchanged", () => {
		const processor = new AlertProcessor({ rules: [] });
		const attrs = { existing: "value" };
		const result = processor.enrich(mockSpan(), attrs);
		expect(result).toBe(attrs);
	});

	it("fires on latency threshold", () => {
		const notifier = new ConsoleNotifier();
		const processor = new AlertProcessor({
			rules: [{
				name: "slow",
				condition: { metric: "latency_avg", operator: "gt", threshold: 500 },
				windowMs: 60000,
				notifiers: [notifier],
			}],
		});

		// 2 second latency span
		processor.enrich(mockSpan({ startTime: [1700000000, 0], endTime: [1700000002, 0] }), {});
		expect(notifier.events).toHaveLength(1);
		expect(notifier.events[0].metric).toBe("latency_avg");
	});
});

// --- Anomaly detection tests ---

function createMockBaselineStore(overrides: {
	anomalous?: boolean;
	zscore?: number;
	count?: number;
}): BaselineStore {
	const count = overrides.count ?? 100;
	const result: AnomalyResult = {
		anomalous: overrides.anomalous ?? false,
		zscore: overrides.zscore ?? 0,
		baseline: {
			count,
			mean: 100,
			stddev: 20,
			p50: 95,
			p95: 140,
			p99: 160,
			lastUpdated: Date.now(),
		},
	};
	return {
		isAnomaly: vi.fn().mockReturnValue(result),
		getBaseline: vi.fn(),
		recordMetric: vi.fn(),
		recomputeBaselines: vi.fn(),
		recordUnknownError: vi.fn(),
		getUnknownErrors: vi.fn(),
		markTicketed: vi.fn(),
		close: vi.fn(),
	} as unknown as BaselineStore;
}

describe("evaluateAnomaly", () => {
	it("fires when z-score exceeds threshold", () => {
		const store = createMockBaselineStore({ anomalous: true, zscore: 3.5, count: 50 });
		const condition: AnomalyCondition = {
			type: "anomaly",
			metric: "latency_ms",
			zscoreThreshold: 3.0,
			minSamples: 30,
		};
		const key: BaselineKey = { model: "gpt-4", tool: "search" };

		const event = evaluateAnomaly(store, key, condition, 200);

		expect(event).toBeDefined();
		expect(event!.metric).toBe("latency_ms");
		expect(event!.value).toBe(200);
		expect(event!.threshold).toBe(3.5); // zscore
	});

	it("does not fire below threshold", () => {
		const store = createMockBaselineStore({ anomalous: false, zscore: 1.2, count: 50 });
		const condition: AnomalyCondition = {
			type: "anomaly",
			metric: "latency_ms",
			zscoreThreshold: 3.0,
			minSamples: 30,
		};
		const key: BaselineKey = { model: "gpt-4", tool: "search" };

		const event = evaluateAnomaly(store, key, condition, 110);

		expect(event).toBeUndefined();
	});

	it("skips when minSamples not met", () => {
		const store = createMockBaselineStore({ anomalous: true, zscore: 5.0, count: 5 });
		const condition: AnomalyCondition = {
			type: "anomaly",
			metric: "latency_ms",
			zscoreThreshold: 3.0,
			minSamples: 30,
		};
		const key: BaselineKey = { model: "gpt-4", tool: "search" };

		const event = evaluateAnomaly(store, key, condition, 500);

		expect(event).toBeUndefined();
	});
});

// --- TicketNotifier tests ---

describe("TicketNotifier", () => {
	it("calls provider.createTicket when no duplicate exists", async () => {
		const createTicket = vi.fn().mockResolvedValue({ id: "T-1", url: "http://t/1", status: "open", createdAt: Date.now() });
		const findDuplicate = vi.fn().mockResolvedValue(undefined);
		const provider: TicketProvider = {
			name: "mock",
			createTicket,
			findDuplicate,
		};

		const notifier = new TicketNotifier(provider);
		const event: AlertEvent = {
			rule: "high-latency",
			metric: "latency_ms",
			value: 5000,
			threshold: 3.2,
			timestamp: Date.now(),
		};

		notifier.notify(event);

		// Allow promises to resolve
		await new Promise((r) => setTimeout(r, 10));

		expect(findDuplicate).toHaveBeenCalledWith("alert:high-latency:latency_ms");
		expect(createTicket).toHaveBeenCalledTimes(1);
		const req: TicketRequest = createTicket.mock.calls[0][0];
		expect(req.title).toContain("high-latency");
		expect(req.severity).toBe("medium");
		expect(req.labels).toEqual(["ho-alert"]);
	});

	it("skips when duplicate exists", async () => {
		const createTicket = vi.fn();
		const findDuplicate = vi.fn().mockResolvedValue({ id: "T-1", url: "http://t/1", status: "open", createdAt: Date.now() });
		const provider: TicketProvider = {
			name: "mock",
			createTicket,
			findDuplicate,
		};

		const notifier = new TicketNotifier(provider, { severity: "high", labels: ["critical"] });
		const event: AlertEvent = {
			rule: "cost-spike",
			metric: "cost_usd",
			value: 10.5,
			threshold: 4.0,
			timestamp: Date.now(),
		};

		notifier.notify(event);

		await new Promise((r) => setTimeout(r, 10));

		expect(findDuplicate).toHaveBeenCalledWith("alert:cost-spike:cost_usd");
		expect(createTicket).not.toHaveBeenCalled();
	});
});
