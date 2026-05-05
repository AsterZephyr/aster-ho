export interface InspectEvalLog {
	readonly eval: { readonly task: string; readonly model: string; readonly run_id: string };
	readonly samples: readonly InspectSample[];
	readonly results?: { readonly scores?: Readonly<Record<string, number>> };
}

export interface InspectSample {
	readonly id: string;
	readonly scores: Readonly<Record<string, { value: number; answer?: string }>>;
	readonly events: readonly InspectEvent[];
}

export interface InspectEvent {
	readonly type: "model" | "tool" | "sandbox" | "score";
	readonly timestamp: string;
	readonly duration_ms: number;
	readonly model?: string;
	readonly tool_name?: string;
	readonly command?: string;
	readonly input_tokens?: number;
	readonly output_tokens?: number;
	readonly exit_code?: number;
	readonly score_value?: number;
	readonly error?: string;
}
