export interface BaselineKey {
	readonly model: string;
	readonly tool: string;
}

export interface MetricEntry {
	readonly timestamp: number;
	readonly traceId: string;
	readonly model: string;
	readonly tool: string;
	readonly errorCategory: string | undefined;
	readonly latencyMs: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly costUsd: number;
	readonly harnessVersion?: string;
}

export interface BaselineStats {
	readonly count: number;
	readonly mean: number;
	readonly stddev: number;
	readonly p50: number;
	readonly p95: number;
	readonly p99: number;
	readonly lastUpdated: number;
}

export interface AnomalyResult {
	readonly anomalous: boolean;
	readonly zscore: number;
	readonly baseline: BaselineStats;
}

export interface UnknownErrorRecord {
	readonly fingerprint: string;
	readonly firstSeen: number;
	readonly lastSeen: number;
	readonly count: number;
	readonly sampleMessage: string;
	readonly sampleTraceId: string;
	readonly sampleModel: string | undefined;
	readonly sampleTool: string | undefined;
	readonly ticketId: string | undefined;
}

export interface BaselineStoreConfig {
	readonly dbPath: string;
	readonly retentionDays?: number; // default 90
}
