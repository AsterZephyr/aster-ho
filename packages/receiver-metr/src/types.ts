export interface METRScoreLog {
	readonly task_id: string;
	readonly run_id: string;
	readonly agent: string;
	readonly score: number;
	readonly max_score: number;
	readonly duration_s: number;
	readonly exec_results: readonly METRExecResult[];
	readonly intermediate_scores?: readonly METRIntermediateScore[];
}

export interface METRExecResult {
	readonly command: string;
	readonly exit_code: number;
	readonly stdout?: string;
	readonly stderr?: string;
	readonly duration_ms: number;
	readonly timestamp: string;
}

export interface METRIntermediateScore {
	readonly value: number;
	readonly timestamp: string;
	readonly message?: string;
}
