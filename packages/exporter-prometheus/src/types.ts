export interface PrometheusConfig {
	readonly port?: number;
	readonly path?: string;
	readonly prefix?: string;
	readonly metrics: readonly MetricDefinition[];
	readonly dimensions?: readonly string[];
}

export interface MetricDefinition {
	readonly name: string;
	readonly type: "histogram" | "counter";
	readonly description?: string;
	readonly source: "span_duration" | "input_tokens" | "output_tokens" | "cost" | "error_count" | "span_count" | "context_rot_count";
	readonly filter?: Readonly<Record<string, string>>;
	readonly buckets?: readonly number[];
}

export interface MetricSample {
	readonly name: string;
	readonly type: "histogram" | "counter";
	readonly value: number;
	readonly labels: Readonly<Record<string, string>>;
}
