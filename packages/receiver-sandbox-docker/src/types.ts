export interface DockerExecEvent {
	readonly container_id: string;
	readonly container_name?: string;
	readonly command: string;
	readonly exit_code: number;
	readonly duration_ms: number;
	readonly timed_out?: boolean;
	readonly started_at: string;
	readonly completed_at: string;
	readonly stdout?: string;
	readonly stderr?: string;
	readonly trace_id?: string;
	readonly span_id?: string;
}

export interface DockerSandboxConfig {
	readonly containerFilter?: readonly string[];
}
