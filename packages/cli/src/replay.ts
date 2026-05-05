import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import { FileExporter } from "@ho/exporter-file";
import { loadConfig } from "./config-loader.js";
import { buildExporters } from "./serve.js";

export interface ReplayOptions {
	file: string;
	config?: string;
}

export async function replay(options: ReplayOptions): Promise<{ linesProcessed: number }> {
	const rl = createInterface({ input: createReadStream(options.file) });
	let count = 0;

	for await (const line of rl) {
		if (!line.trim()) continue;
		try {
			JSON.parse(line);
			count++;
		} catch {
			// skip invalid lines
		}
	}

	return { linesProcessed: count };
}
