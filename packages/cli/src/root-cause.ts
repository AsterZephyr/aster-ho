import { readFile } from "node:fs/promises";
import { loadConfig } from "./config-loader.js";

export interface RootCauseOptions {
	readonly config: string;
	readonly traceId: string;
	readonly file?: string;
}

export interface RootCauseResult {
	readonly traceId: string;
	readonly triggerSpan: { spanId: string; name: string; error: string } | undefined;
	readonly cascadeSpans: Array<{ spanId: string; name: string }>;
	readonly tokenWaste: number;
}

interface SpanRecord {
	readonly traceId: string;
	readonly spanId: string;
	readonly parentSpanId?: string;
	readonly name: string;
	readonly startTimeUnixNano: number;
	readonly endTimeUnixNano: number;
	readonly attributes?: Record<string, unknown>;
	readonly status?: { code?: number; message?: string };
}

export async function rootCause(
	options: RootCauseOptions,
): Promise<{ exitCode: number; output: string }> {
	if (!options.file) {
		return { exitCode: 1, output: "Error: --file is required for root-cause analysis" };
	}

	let spans: readonly SpanRecord[];
	try {
		spans = await loadSpansFromFile(options.file, options.traceId);
	} catch (err) {
		return { exitCode: 1, output: `Error reading trace file: ${(err as Error).message}` };
	}

	if (spans.length === 0) {
		return { exitCode: 1, output: `No spans found for trace ${options.traceId}` };
	}

	const result = analyzeTrace(options.traceId, spans);
	const output = formatRootCause(result);
	return { exitCode: result.triggerSpan ? 1 : 0, output };
}

async function loadSpansFromFile(
	filePath: string,
	traceId: string,
): Promise<readonly SpanRecord[]> {
	const content = await readFile(filePath, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim().length > 0);
	const spans: SpanRecord[] = [];

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line) as SpanRecord;
			if (parsed.traceId === traceId) {
				spans.push(parsed);
			}
		} catch {
			// skip invalid lines
		}
	}

	return spans;
}

function isErrorSpan(span: SpanRecord): boolean {
	if (span.status?.code === 2) return true;
	const attrs = span.attributes ?? {};
	return attrs.error !== undefined || attrs["otel.status_code"] === "ERROR";
}

function getErrorMessage(span: SpanRecord): string {
	if (span.status?.message) return span.status.message;
	const attrs = span.attributes ?? {};
	if (typeof attrs["error.message"] === "string") return attrs["error.message"];
	if (typeof attrs["exception.message"] === "string") return attrs["exception.message"];
	return "Unknown error";
}

function getTokens(span: SpanRecord): number {
	const attrs = span.attributes ?? {};
	const input =
		typeof attrs["gen_ai.usage.input_tokens"] === "number"
			? (attrs["gen_ai.usage.input_tokens"] as number)
			: 0;
	const output =
		typeof attrs["gen_ai.usage.output_tokens"] === "number"
			? (attrs["gen_ai.usage.output_tokens"] as number)
			: 0;
	return input + output;
}

export function analyzeTrace(traceId: string, spans: readonly SpanRecord[]): RootCauseResult {
	const sorted = [...spans].sort((a, b) => a.startTimeUnixNano - b.startTimeUnixNano);

	let triggerSpan: RootCauseResult["triggerSpan"] = undefined;
	const cascadeSpans: Array<{ spanId: string; name: string }> = [];
	let tokenWaste = 0;
	let foundTrigger = false;

	for (const span of sorted) {
		if (!foundTrigger && isErrorSpan(span)) {
			triggerSpan = {
				spanId: span.spanId,
				name: span.name,
				error: getErrorMessage(span),
			};
			foundTrigger = true;
			continue;
		}

		if (foundTrigger) {
			if (isErrorSpan(span)) {
				cascadeSpans.push({ spanId: span.spanId, name: span.name });
			}
			tokenWaste += getTokens(span);
		}
	}

	return { traceId, triggerSpan, cascadeSpans, tokenWaste };
}

export function formatRootCause(result: RootCauseResult): string {
	const lines: string[] = [`Trace: ${result.traceId}`, ""];

	if (!result.triggerSpan) {
		lines.push("No error spans found in trace.");
		return lines.join("\n");
	}

	lines.push(`Trigger: [${result.triggerSpan.spanId}] ${result.triggerSpan.name}`);
	lines.push(`  Error: ${result.triggerSpan.error}`);
	lines.push("");
	lines.push(`Cascade spans: ${result.cascadeSpans.length}`);

	for (const span of result.cascadeSpans) {
		lines.push(`  - [${span.spanId}] ${span.name}`);
	}

	lines.push("");
	lines.push(`Token waste after trigger: ${result.tokenWaste}`);

	return lines.join("\n");
}
