import type { METRExecResult, METRIntermediateScore, METRScoreLog } from "./types.js";

export function parseScoreLog(data: unknown): METRScoreLog {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid METR score log: expected object");
	}

	const obj = data as Record<string, unknown>;

	if (!obj.task_id || typeof obj.task_id !== "string") {
		throw new Error("Invalid METR score log: missing task_id");
	}
	if (!obj.run_id || typeof obj.run_id !== "string") {
		throw new Error("Invalid METR score log: missing run_id");
	}

	return {
		task_id: obj.task_id,
		run_id: obj.run_id,
		agent: String(obj.agent ?? "unknown"),
		score: typeof obj.score === "number" ? obj.score : 0,
		max_score: typeof obj.max_score === "number" ? obj.max_score : 1,
		duration_s: typeof obj.duration_s === "number" ? obj.duration_s : 0,
		exec_results: Array.isArray(obj.exec_results) ? obj.exec_results.map(parseExecResult) : [],
		intermediate_scores: Array.isArray(obj.intermediate_scores)
			? obj.intermediate_scores.map(parseIntermediateScore)
			: undefined,
	};
}

function parseExecResult(raw: unknown): METRExecResult {
	if (!raw || typeof raw !== "object") {
		return { command: "", exit_code: -1, duration_ms: 0, timestamp: "" };
	}
	const obj = raw as Record<string, unknown>;

	return {
		command: String(obj.command ?? ""),
		exit_code: typeof obj.exit_code === "number" ? obj.exit_code : -1,
		stdout: typeof obj.stdout === "string" ? obj.stdout : undefined,
		stderr: typeof obj.stderr === "string" ? obj.stderr : undefined,
		duration_ms: typeof obj.duration_ms === "number" ? obj.duration_ms : 0,
		timestamp: String(obj.timestamp ?? ""),
	};
}

function parseIntermediateScore(raw: unknown): METRIntermediateScore {
	if (!raw || typeof raw !== "object") {
		return { value: 0, timestamp: "" };
	}
	const obj = raw as Record<string, unknown>;

	return {
		value: typeof obj.value === "number" ? obj.value : 0,
		timestamp: String(obj.timestamp ?? ""),
		message: typeof obj.message === "string" ? obj.message : undefined,
	};
}
