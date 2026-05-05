import { init, shutdown, withAgentLoop } from "@ho/sdk";
import { CostEnricher } from "@ho/enricher-cost";
import OpenAI from "openai";

init({
	serviceName: "basic-agent-example",
	enrichers: [new CostEnricher()],
	dev: true,
});

const openai = new OpenAI();

const tools: OpenAI.ChatCompletionTool[] = [
	{
		type: "function",
		function: {
			name: "get_weather",
			description: "Get current weather for a location",
			parameters: {
				type: "object",
				properties: {
					location: { type: "string", description: "City name" },
				},
				required: ["location"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_time",
			description: "Get the current time",
			parameters: { type: "object", properties: {} },
		},
	},
];

function executeGetWeather(location: string): string {
	return JSON.stringify({ location, temperature: 22, unit: "celsius", condition: "sunny" });
}

function executeGetTime(): string {
	return JSON.stringify({ time: new Date().toISOString() });
}

async function main() {
	const result = await withAgentLoop("weather-agent", async (loop) => {
		const messages: OpenAI.ChatCompletionMessageParam[] = [
			{ role: "system", content: "You are a helpful assistant. Use tools when needed." },
			{ role: "user", content: "What's the weather in Tokyo and what time is it?" },
		];

		while (!loop.done) {
			loop.iteration++;

			const response = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages,
				tools,
			});

			const choice = response.choices[0];
			const message = choice.message;
			messages.push(message);

			if (choice.finish_reason === "tool_calls" && message.tool_calls) {
				for (const toolCall of message.tool_calls) {
					const result = await loop.traceTool(toolCall.function.name, async () => {
						const args = JSON.parse(toolCall.function.arguments);
						switch (toolCall.function.name) {
							case "get_weather":
								return executeGetWeather(args.location);
							case "get_time":
								return executeGetTime();
							default:
								return JSON.stringify({ error: "unknown tool" });
						}
					});

					messages.push({
						role: "tool",
						tool_call_id: toolCall.id,
						content: result as string,
					});
				}
			} else {
				loop.finish(message.content);
			}
		}

		return loop.output as string;
	});

	console.log("\n--- Agent Result ---");
	console.log(result);

	await shutdown();
}

main().catch(console.error);
