export interface TailSamplerConfig {
	readonly defaultRate: number;
	readonly rules: readonly SamplingRule[];
}

export interface SamplingRule {
	readonly name: string;
	readonly decision: "always_keep" | "always_drop" | "probabilistic";
	readonly rate?: number;
	readonly condition: SamplingCondition;
}

export type SamplingCondition =
	| { readonly type: "status_error" }
	| { readonly type: "attribute_exists"; readonly key: string }
	| { readonly type: "attribute_equals"; readonly key: string; readonly value: string | number }
	| { readonly type: "attribute_gt"; readonly key: string; readonly value: number };
