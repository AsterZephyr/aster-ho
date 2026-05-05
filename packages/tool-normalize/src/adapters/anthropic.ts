import { repairAndParse } from "../repair.js";
import type {
	ToolSchemaAdapter,
	UnifiedToolCall,
	UnifiedToolDefinition,
	UnifiedToolResult,
} from "../types.js";

export class AnthropicToolAdapter implements ToolSchemaAdapter {
	provider = "anthropic" as const;

	encodeDefinitions(tools: UnifiedToolDefinition[]): unknown[] {
		return tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object",
				...tool.parameters,
			},
		}));
	}

	decodeToolCalls(response: unknown): UnifiedToolCall[] {
		const msg = response as {
			content?: Array<{
				type: string;
				id?: string;
				name?: string;
				input?: Record<string, unknown>;
			}>;
		};

		if (!msg?.content) return [];

		return msg.content
			.filter((block) => block.type === "tool_use")
			.map((block) => {
				const input = block.input ?? {};
				// Anthropic returns input as object directly, but sometimes as string
				if (typeof input === "string") {
					const result = repairAndParse(input);
					return {
						id: block.id ?? "",
						name: block.name ?? "",
						arguments: result.value,
						raw: input,
						repaired: result.repaired,
						repairStrategy: result.strategyUsed,
						provider: "anthropic" as const,
					};
				}
				return {
					id: block.id ?? "",
					name: block.name ?? "",
					arguments: input,
					provider: "anthropic" as const,
				};
			});
	}

	encodeResults(results: UnifiedToolResult[]): unknown[] {
		return results.map((r) => ({
			type: "tool_result",
			tool_use_id: r.callId,
			content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
			...(r.isError && { is_error: true }),
		}));
	}
}
