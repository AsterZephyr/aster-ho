export interface AlertRule {
	readonly name: string;
	readonly condition: AlertCondition | AnomalyCondition;
	readonly windowMs: number;
	readonly cooldownMs?: number;
	readonly notifiers: AlertNotifier[];
}

export interface AlertCondition {
	readonly metric: "error_rate" | "latency_avg" | "cost_total" | "span_count";
	readonly operator: "gt" | "lt" | "gte" | "lte";
	readonly threshold: number;
	readonly filter?: Readonly<Record<string, string>>;
}

export interface AnomalyCondition {
	readonly type: "anomaly";
	readonly metric: "latency_ms" | "input_tokens" | "output_tokens" | "cost_usd" | "error_rate";
	readonly zscoreThreshold: number;
	readonly minSamples: number;
	readonly filter?: Readonly<Record<string, string>>;
}

export function isAnomalyCondition(c: AlertCondition | AnomalyCondition): c is AnomalyCondition {
	return "type" in c && (c as AnomalyCondition).type === "anomaly";
}

export interface AlertNotifier {
	notify(event: AlertEvent): void;
}

export interface AlertEvent {
	readonly rule: string;
	readonly metric: string;
	readonly value: number;
	readonly threshold: number;
	readonly timestamp: number;
}

export interface AlertProcessorConfig {
	readonly rules: readonly AlertRule[];
}

export interface WindowBucket {
	readonly timestamp: number;
	readonly spanCount: number;
	readonly errorCount: number;
	readonly latencySum: number;
	readonly costSum: number;
}
