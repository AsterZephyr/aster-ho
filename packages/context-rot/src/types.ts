export type ContextRotType = "token_bloat" | "error_cascade" | "repeated_calls";

export interface ContextRotConfig {
	/** Ratio threshold for token growth detection. Default: 2.0 */
	readonly tokenBloatThreshold?: number;
	/** Minimum consecutive errors after first to trigger cascade. Default: 2 */
	readonly cascadeMinErrors?: number;
	/** Number of identical tool calls to trigger repeated_calls. Default: 3 */
	readonly repeatCallThreshold?: number;
	/** Milliseconds before evicting stale traces. Default: 300_000 (5 min) */
	readonly traceEvictionMs?: number;
}

export interface TraceState {
	readonly traceId: string;
	readonly firstInputTokens: number | undefined;
	readonly firstErrorSpanId: string | undefined;
	readonly errorsAfterFirst: number;
	readonly toolCallCounts: ReadonlyMap<string, number>;
	readonly lastSeen: number;
}
