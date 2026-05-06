import { FileExporter } from "@ho/exporter-file";
import { PrometheusExporter } from "@ho/exporter-prometheus";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { loadConfig } from "./config-loader.js";
import type { HoConfigFile } from "./types.js";

export function buildExporters(config: HoConfigFile): SpanExporter[] {
	const exporters: SpanExporter[] = [];

	if (config.exporters?.file) {
		const fileConfig = config.exporters.file as { path?: string };
		exporters.push(new FileExporter({ filePath: fileConfig.path ?? "./traces.jsonl" }));
	}

	if (config.exporters?.prometheus) {
		const promConfig = config.exporters.prometheus as { port?: number; metrics?: any[] };
		exporters.push(
			new PrometheusExporter({
				port: promConfig.port ?? 9464,
				metrics: promConfig.metrics ?? [
					{ name: "llm_calls", type: "counter" as const, source: "span_count" as const },
				],
			}),
		);
	}

	return exporters;
}

export interface ServeOptions {
	config: string;
}

export async function serve(options: ServeOptions): Promise<{ shutdown: () => Promise<void> }> {
	const config = await loadConfig(options.config);
	const exporters = buildExporters(config);

	const shutdownFns: Array<() => Promise<void>> = [];

	for (const exporter of exporters) {
		if ("start" in exporter && typeof (exporter as any).start === "function") {
			await (exporter as any).start();
		}
		shutdownFns.push(() => exporter.shutdown());
	}

	return {
		shutdown: async () => {
			for (const fn of shutdownFns) {
				await fn();
			}
		},
	};
}
