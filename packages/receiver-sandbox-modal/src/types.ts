export interface ModalContainerEvent {
	readonly container_id: string;
	readonly function_name: string;
	readonly action: "exec" | "spawn" | "terminate";
	readonly command?: string;
	readonly exit_code?: number;
	readonly duration_ms: number;
	readonly started_at: string;
	readonly completed_at: string;
	readonly error?: string;
	readonly trace_id?: string;
	readonly span_id?: string;
}

export type ModalSandboxConfig = Record<string, never>;
