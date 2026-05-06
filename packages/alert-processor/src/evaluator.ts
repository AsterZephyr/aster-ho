import type { AnomalyResult, BaselineKey, BaselineStore } from "@ho/baseline";
import type { AlertCondition, AlertEvent, AnomalyCondition } from "./types.js";
import type { WindowState } from "./window.js";
import { getMetricValue } from "./window.js";

export function evaluate(
	state: WindowState,
	condition: AlertCondition,
	ruleName: string,
	now: number,
): AlertEvent | undefined {
	if (condition.filter) {
		// Filter-based evaluation skipped at window level — handled by processor
	}

	const value = getMetricValue(state, condition.metric);
	const triggered = compare(value, condition.operator, condition.threshold);

	if (!triggered) return undefined;

	return {
		rule: ruleName,
		metric: condition.metric,
		value,
		threshold: condition.threshold,
		timestamp: now,
	};
}

export function evaluateAnomaly(
	store: BaselineStore,
	key: BaselineKey,
	condition: AnomalyCondition,
	value: number,
): AlertEvent | undefined {
	const result: AnomalyResult = store.isAnomaly(
		key,
		condition.metric,
		value,
		condition.zscoreThreshold,
	);

	if (result.baseline.count < condition.minSamples) {
		return undefined;
	}

	if (!result.anomalous) {
		return undefined;
	}

	return {
		rule: `${key.model}/${key.tool}`,
		metric: condition.metric,
		value,
		threshold: result.zscore,
		timestamp: Date.now(),
	};
}

function compare(value: number, operator: string, threshold: number): boolean {
	switch (operator) {
		case "gt":
			return value > threshold;
		case "lt":
			return value < threshold;
		case "gte":
			return value >= threshold;
		case "lte":
			return value <= threshold;
		default:
			return false;
	}
}
