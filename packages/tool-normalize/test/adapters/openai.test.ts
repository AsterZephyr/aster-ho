import { describe, expect, it } from "vitest";
import { OpenAIToolAdapter } from "../../src/adapters/openai.js";
import type { UnifiedToolDefinition, UnifiedToolResult } from "../../src/types.js";

const adapter = new OpenAIToolAdapter();

describe("OpenAIToolAdapter", () => {
	describe("encodeDefinitions", () => {
		it("converts unified definitions to OpenAI format", () => {
			const tools: UnifiedToolDefinition[] = [
				{
					name: "get_weather",
					description: "Get current weather",
					parameters: {
						type: "object",
						properties: { location: { type: "string" } },
						required: ["location"],
					},
				},
			];

			const encoded = adapter.encodeDefinitions(tools) as Array<Record<string, unknown>>;
			expect(encoded).toHaveLength(1);
			expect(encoded[0]).toEqual({
				type: "function",
				function: {
					name: "get_weather",
					description: "Get current weather",
					parameters: {
						type: "object",
						properties: { location: { type: "string" } },
						required: ["location"],
					},
				},
			});
		});

		it("includes strict when specified", () => {
			const tools: UnifiedToolDefinition[] = [
				{ name: "tool1", parameters: { type: "object" }, strict: true },
			];
			const encoded = adapter.encodeDefinitions(tools) as Array<Record<string, unknown>>;
			expect((encoded[0] as any).function.strict).toBe(true);
		});
	});

	describe("decodeToolCalls", () => {
		it("decodes OpenAI chat completion response", () => {
			const response = {
				choices: [
					{
						message: {
							tool_calls: [
								{
									id: "call_123",
									function: {
										name: "get_weather",
										arguments: '{"location": "San Francisco"}',
									},
								},
							],
						},
					},
				],
			};

			const calls = adapter.decodeToolCalls(response);
			expect(calls).toHaveLength(1);
			expect(calls[0]).toEqual({
				id: "call_123",
				name: "get_weather",
				arguments: { location: "San Francisco" },
				raw: '{"location": "San Francisco"}',
				repaired: false,
				repairStrategy: undefined,
				provider: "openai",
			});
		});

		it("repairs malformed arguments", () => {
			const response = {
				choices: [
					{
						message: {
							tool_calls: [
								{
									id: "call_456",
									function: {
										name: "search",
										arguments: '{"query": "test",}',
									},
								},
							],
						},
					},
				],
			};

			const calls = adapter.decodeToolCalls(response);
			expect(calls[0].arguments).toEqual({ query: "test" });
			expect(calls[0].repaired).toBe(true);
		});

		it("returns empty array for missing tool_calls", () => {
			expect(adapter.decodeToolCalls({ choices: [{ message: {} }] })).toEqual([]);
			expect(adapter.decodeToolCalls({})).toEqual([]);
		});
	});

	describe("encodeResults", () => {
		it("encodes results to OpenAI message format", () => {
			const results: UnifiedToolResult[] = [
				{ callId: "call_123", content: { temp: 72, unit: "F" } },
			];

			const encoded = adapter.encodeResults(results) as Array<Record<string, unknown>>;
			expect(encoded[0]).toEqual({
				role: "tool",
				tool_call_id: "call_123",
				content: '{"temp":72,"unit":"F"}',
			});
		});

		it("passes string content directly", () => {
			const results: UnifiedToolResult[] = [
				{ callId: "call_123", content: "Success" },
			];
			const encoded = adapter.encodeResults(results) as Array<Record<string, unknown>>;
			expect(encoded[0].content).toBe("Success");
		});
	});
});
