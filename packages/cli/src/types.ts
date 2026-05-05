export interface HoConfigFile {
	readonly service_name?: string;
	readonly enrichers?: readonly string[];
	readonly exporters?: Record<string, Record<string, unknown>>;
	readonly alerts?: { readonly rules: readonly Record<string, unknown>[] };
	readonly metrics?: Record<string, unknown>;
	readonly context_rot?: {
		readonly token_bloat_threshold?: number;
		readonly cascade_min_errors?: number;
		readonly repeat_call_threshold?: number;
	};
	readonly baseline?: {
		readonly db_path?: string;
		readonly recompute_interval?: string;
		readonly retention_days?: number;
		readonly anomaly_zscore?: number;
	};
	readonly tickets?: {
		readonly provider?: string;
		readonly github?: { readonly repo: string; readonly labels?: readonly string[] };
		readonly linear?: { readonly api_key?: string; readonly team_id?: string };
	};
}

export interface ValidationResult {
	readonly valid: boolean;
	readonly errors: readonly string[];
}
