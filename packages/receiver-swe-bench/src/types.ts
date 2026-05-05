export interface SWEBenchInstance {
	readonly instance_id: string;
	readonly resolved: boolean;
	readonly duration_ms?: number;
	readonly error?: string;
	readonly patch_applied?: boolean;
	readonly fail_to_pass?: { passed: number; total: number };
	readonly pass_to_pass?: { passed: number; total: number };
	readonly timed_out?: boolean;
}

export interface SWEBenchReport {
	readonly run_id: string;
	readonly model: string;
	readonly dataset?: string;
	readonly instances: readonly SWEBenchInstance[];
	readonly total_duration_ms?: number;
}
