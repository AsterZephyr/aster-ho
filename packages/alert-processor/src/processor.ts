import type { BaselineKey, BaselineStore } from "@ho/baseline";
import type { SpanEnricher } from "@ho/sdk";
import { SpanStatusCode } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { evaluate, evaluateAnomaly } from "./evaluator.js";
import type { AlertProcessorConfig, AlertRule } from "./types.js";
import { isAnomalyCondition } from "./types.js";
import type { WindowState } from "./window.js";
import { createWindow, getMetricValue, pushMetric } from "./window.js";

export interface AlertProcessorOptions extends AlertProcessorConfig {
	readonly baselineStore?: BaselineStore;
}

export class AlertProcessor implements SpanEnricher {
	private readonly rules: readonly AlertRule[];
	private readonly baselineStore: BaselineStore | undefined;
	private windows: Map<string, WindowState> = new Map();
	private lastFired: Map<string, number> = new Map();

	constructor(config: AlertProcessorOptions) {
		this.rules = config.rules;
		this.baselineStore = config.baselineStore;
		for (const rule of this.rules) {
			this.windows.set(rule.name, createWindow(rule.windowMs));
		}
	}

	enrich(span: ReadableSpan, attrs: Attributes): Attributes {
		const now = Date.now();
		const isError = span.status.code === SpanStatusCode.ERROR;
		const [startSec, startNano] = span.startTime;
		const [endSec, endNano] = span.endTime;
		const latencyMs = (endSec - startSec) * 1000 + (endNano - startNano) / 1_000_000;
		const costUsd = typeof attrs["ho.cost.usd"] === "number" ? attrs["ho.cost.usd"] : 0;

		for (const rule of this.rules) {
			const condition = rule.condition;

			if (isAnomalyCondition(condition)) {
				if (!this.baselineStore) continue;

				if (condition.filter && !this.matchesFilter(span, condition.filter)) {
					continue;
				}

				const window = this.windows.get(rule.name)!;
				const updated = pushMetric(window, now, { isError, latencyMs, costUsd });
				this.windows.set(rule.name, updated);

				const value = this.getAnomalyMetricValue(
					condition.metric,
					updated,
					latencyMs,
					costUsd,
					span,
				);
				const key: BaselineKey = {
					model: String(span.attributes["gen_ai.request.model"] ?? "unknown"),
					tool: String(span.attributes["ho.tool.name"] ?? "unknown"),
				};

				const event = evaluateAnomaly(this.baselineStore, key, condition, value);
				if (event && this.canFire(rule, now)) {
					this.lastFired.set(rule.name, now);
					for (const notifier of rule.notifiers) {
						notifier.notify(event);
					}
				}
			} else {
				if (condition.filter && !this.matchesFilter(span, condition.filter)) {
					continue;
				}

				const window = this.windows.get(rule.name)!;
				const updated = pushMetric(window, now, { isError, latencyMs, costUsd });
				this.windows.set(rule.name, updated);

				const event = evaluate(updated, condition, rule.name, now);
				if (event && this.canFire(rule, now)) {
					this.lastFired.set(rule.name, now);
					for (const notifier of rule.notifiers) {
						notifier.notify(event);
					}
				}
			}
		}

		return attrs;
	}

	private getAnomalyMetricValue(
		metric: string,
		window: WindowState,
		latencyMs: number,
		costUsd: number,
		span: ReadableSpan,
	): number {
		switch (metric) {
			case "latency_ms":
				return latencyMs;
			case "cost_usd":
				return costUsd;
			case "input_tokens": {
				const v = span.attributes["gen_ai.usage.input_tokens"];
				return typeof v === "number" ? v : 0;
			}
			case "output_tokens": {
				const v = span.attributes["gen_ai.usage.output_tokens"];
				return typeof v === "number" ? v : 0;
			}
			case "error_rate":
				return getMetricValue(window, "error_rate");
			default:
				return 0;
		}
	}

	private canFire(rule: AlertRule, now: number): boolean {
		const last = this.lastFired.get(rule.name);
		if (!last) return true;
		const cooldown = rule.cooldownMs ?? 0;
		return now - last >= cooldown;
	}

	private matchesFilter(span: ReadableSpan, filter: Readonly<Record<string, string>>): boolean {
		for (const [key, value] of Object.entries(filter)) {
			if (String(span.attributes[key] ?? "") !== value) return false;
		}
		return true;
	}
}
