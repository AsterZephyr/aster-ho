import type { InspectEvalLog, InspectEvent, InspectSample } from "./types.js";

export function parseEvalLog(data: unknown): InspectEvalLog {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid Inspect AI eval log: expected object");
	}

	const obj = data as Record<string, unknown>;
	const evalObj = obj.eval as Record<string, unknown> | undefined;

	if (!evalObj || typeof evalObj !== "object") {
		throw new Error("Invalid Inspect AI eval log: missing eval field");
	}
	if (!evalObj.run_id || typeof evalObj.run_id !== "string") {
		throw new Error("Invalid Inspect AI eval log: missing eval.run_id");
	}

	const rawSamples = Array.isArray(obj.samples) ? obj.samples : [];

	return {
		eval: {
			task: String(evalObj.task ?? "unknown"),
			model: String(evalObj.model ?? "unknown"),
			run_id: evalObj.run_id,
		},
		samples: rawSamples.map(parseSample),
		results: parseResults(obj.results),
	};
}

function parseSample(raw: unknown): InspectSample {
	if (!raw || typeof raw !== "object") {
		throw new Error("Invalid sample: expected object");
	}
	const obj = raw as Record<string, unknown>;

	return {
		id: String(obj.id ?? "unknown"),
		scores: (obj.scores as Record<string, { value: number }>) ?? {},
		events: Array.isArray(obj.events) ? obj.events.map(parseEvent) : [],
	};
}

function parseEvent(raw: unknown): InspectEvent {
	if (!raw || typeof raw !== "object") {
		return { type: "model", timestamp: "", duration_ms: 0 };
	}
	const obj = raw as Record<string, unknown>;

	return {
		type: (obj.type as InspectEvent["type"]) ?? "model",
		timestamp: String(obj.timestamp ?? ""),
		duration_ms: typeof obj.duration_ms === "number" ? obj.duration_ms : 0,
		model: typeof obj.model === "string" ? obj.model : undefined,
		tool_name: typeof obj.tool_name === "string" ? obj.tool_name : undefined,
		command: typeof obj.command === "string" ? obj.command : undefined,
		input_tokens: typeof obj.input_tokens === "number" ? obj.input_tokens : undefined,
		output_tokens: typeof obj.output_tokens === "number" ? obj.output_tokens : undefined,
		exit_code: typeof obj.exit_code === "number" ? obj.exit_code : undefined,
		score_value: typeof obj.score_value === "number" ? obj.score_value : undefined,
		error: typeof obj.error === "string" ? obj.error : undefined,
	};
}

function parseResults(raw: unknown): { scores?: Record<string, number> } | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const obj = raw as Record<string, unknown>;
	return { scores: (obj.scores as Record<string, number>) ?? undefined };
}
