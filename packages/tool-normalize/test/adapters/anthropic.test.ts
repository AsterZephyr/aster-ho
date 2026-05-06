import { describe, expect, it } from "vitest";
import { AnthropicToolAdapter } from "../../src/adapters/anthropic.js";
import type { UnifiedToolDefinition, UnifiedToolResult } from "../../src/types.js";

const adapter = new AnthropicToolAdapter();

describe("AnthropicToolAdapter", () => {
	describe("encodeDefinitions", () => {
		it("converts unified definitions to Anthropic format", () => {
			const tools: UnifiedToolDefinition[] = [
				{
					name: "get_weather",
					description: "Get weather info",
					parameters: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			];

			const encoded = adapter.encodeDefinitions(tools) as Array<Record<string, unknown>>;
			expect(encoded[0]).toEqual({
				name: "get_weather",
				description: "Get weather info",
				input_schema: {
					type: "object",
					properties: { city: { type: "string" } },
					required: ["city"],
				},
			});
		});
	});

	describe("decodeToolCalls", () => {
		it("decodes Anthropic message response with tool_use blocks", () => {
			const response = {
				content: [
					{ type: "text", text: "Let me check the weather." },
					{
						type: "tool_use",
						id: "toolu_01",
						name: "get_weather",
						input: { city: "London" },
					},
				],
			};

			const calls = adapter.decodeToolCalls(response);
			expect(calls).toHaveLength(1);
			expect(calls[0]).toEqual({
				id: "toolu_01",
				name: "get_weather",
				arguments: { city: "London" },
				provider: "anthropic",
			});
		});

		it("handles multiple tool_use blocks", () => {
			const response = {
				content: [
					{ type: "tool_use", id: "t1", name: "search", input: { q: "a" } },
					{ type: "tool_use", id: "t2", name: "read", input: { path: "/tmp" } },
				],
			};

			const calls = adapter.decodeToolCalls(response);
			expect(calls).toHaveLength(2);
		});

		it("returns empty for no content", () => {
			expect(adapter.decodeToolCalls({})).toEqual([]);
		});
	});

	describe("encodeResults", () => {
		it("encodes results to Anthropic tool_result format", () => {
			const results: UnifiedToolResult[] = [{ callId: "toolu_01", content: { temp: 15 } }];

			const encoded = adapter.encodeResults(results) as Array<Record<string, unknown>>;
			expect(encoded[0]).toEqual({
				type: "tool_result",
				tool_use_id: "toolu_01",
				content: '{"temp":15}',
			});
		});

		it("includes is_error flag", () => {
			const results: UnifiedToolResult[] = [
				{ callId: "toolu_01", content: "Not found", isError: true },
			];
			const encoded = adapter.encodeResults(results) as Array<Record<string, unknown>>;
			expect(encoded[0]).toEqual({
				type: "tool_result",
				tool_use_id: "toolu_01",
				content: "Not found",
				is_error: true,
			});
		});
	});
});
