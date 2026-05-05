import type { SWEBenchInstance, SWEBenchReport } from "./types.js";

export function parseReport(data: unknown): SWEBenchReport {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid SWE-bench report: expected object");
	}

	const obj = data as Record<string, unknown>;

	if (!obj.run_id || typeof obj.run_id !== "string") {
		throw new Error("Invalid SWE-bench report: missing run_id");
	}
	if (!obj.model || typeof obj.model !== "string") {
		throw new Error("Invalid SWE-bench report: missing model");
	}

	const rawInstances = Array.isArray(obj.instances) ? obj.instances : [];
	const instances: SWEBenchInstance[] = rawInstances.map(parseInstance);

	return {
		run_id: obj.run_id,
		model: obj.model,
		dataset: typeof obj.dataset === "string" ? obj.dataset : undefined,
		instances,
		total_duration_ms: typeof obj.total_duration_ms === "number" ? obj.total_duration_ms : undefined,
	};
}

function parseInstance(raw: unknown): SWEBenchInstance {
	if (!raw || typeof raw !== "object") {
		throw new Error("Invalid instance: expected object");
	}

	const obj = raw as Record<string, unknown>;

	return {
		instance_id: String(obj.instance_id ?? "unknown"),
		resolved: Boolean(obj.resolved),
		duration_ms: typeof obj.duration_ms === "number" ? obj.duration_ms : undefined,
		error: typeof obj.error === "string" ? obj.error : undefined,
		patch_applied: typeof obj.patch_applied === "boolean" ? obj.patch_applied : undefined,
		fail_to_pass: parseTestResult(obj.fail_to_pass),
		pass_to_pass: parseTestResult(obj.pass_to_pass),
		timed_out: typeof obj.timed_out === "boolean" ? obj.timed_out : undefined,
	};
}

function parseTestResult(raw: unknown): { passed: number; total: number } | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.passed !== "number" || typeof obj.total !== "number") return undefined;
	return { passed: obj.passed, total: obj.total };
}
