export interface E2BSandboxEvent {
	readonly sandbox_id: string;
	readonly action: "exec" | "start" | "stop" | "write_file" | "read_file";
	readonly command?: string;
	readonly path?: string;
	readonly exit_code?: number;
	readonly duration_ms: number;
	readonly started_at: string;
	readonly completed_at: string;
	readonly error?: string;
	readonly trace_id?: string;
	readonly span_id?: string;
}

export interface E2BSandboxConfig {
	readonly wrapCommands?: boolean;
}
