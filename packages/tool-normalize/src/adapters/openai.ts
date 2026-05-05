import { repairAndParse } from "../repair.js";
import type {
	JsonSchema,
	ToolSchemaAdapter,
	UnifiedToolCall,
	UnifiedToolDefinition,
	UnifiedToolResult,
} from "../types.js";

export class OpenAIToolAdapter implements ToolSchemaAdapter {
	provider = "openai" as const;

	encodeDefinitions(tools: UnifiedToolDefinition[]): unknown[] {
		return tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters as Record<string, unknown>,
				...(tool.strict !== undefined && { strict: tool.strict }),
			},
		}));
	}

	decodeToolCalls(response: unknown): UnifiedToolCall[] {
		const msg = response as {
			choices?: Array<{
				message?: {
					tool_calls?: Array<{
						id: string;
						function: { name: string; arguments: string };
					}>;
				};
			}>;
		};

		const toolCalls = msg?.choices?.[0]?.message?.tool_calls;
		if (!toolCalls) return [];

		return toolCalls.map((tc) => {
			const result = repairAndParse(tc.function.arguments);
			return {
				id: tc.id,
				name: tc.function.name,
				arguments: result.value,
				raw: tc.function.arguments,
				repaired: result.repaired,
				repairStrategy: result.strategyUsed,
				provider: "openai" as const,
			};
		});
	}

	encodeResults(results: UnifiedToolResult[]): unknown[] {
		return results.map((r) => ({
			role: "tool",
			tool_call_id: r.callId,
			content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
		}));
	}
}

export function encodeJsonSchema(schema: JsonSchema): Record<string, unknown> {
	return schema as Record<string, unknown>;
}
