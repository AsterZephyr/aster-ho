export interface UnifiedToolDefinition {
	name: string;
	description?: string;
	parameters: JsonSchema;
	strict?: boolean;
}

export interface UnifiedToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	raw?: string;
	repaired?: boolean;
	repairStrategy?: string;
	provider: ToolProvider;
}

export interface UnifiedToolResult {
	callId: string;
	content: unknown;
	isError?: boolean;
}

export type ToolProvider = "openai" | "anthropic" | "gemini";

export interface ToolSchemaAdapter {
	provider: ToolProvider;
	encodeDefinitions(tools: UnifiedToolDefinition[]): unknown;
	decodeToolCalls(response: unknown): UnifiedToolCall[];
	encodeResults(results: UnifiedToolResult[]): unknown;
}

export interface RepairStrategy {
	name: string;
	attempt(raw: string): string | null;
}

export interface ParseResult {
	success: boolean;
	value: Record<string, unknown>;
	repaired: boolean;
	strategyUsed?: string;
	error?: string;
}

export type JsonSchema = {
	type?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	description?: string;
	enum?: unknown[];
	[key: string]: unknown;
};
