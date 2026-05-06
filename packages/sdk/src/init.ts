import type { Instrumentation } from "@opentelemetry/instrumentation";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchSpanProcessor,
	ConsoleSpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { EnrichingExporter } from "./enriching-exporter.js";
import type { HoConfig } from "./types.js";

let _provider: NodeTracerProvider | undefined;
let _instrumentations: Instrumentation[] = [];

const DEFAULT_BATCH_CONFIG = {
	maxQueueSize: 2048,
	maxExportBatchSize: 64,
	scheduledDelayMillis: 5000,
	exportTimeoutMillis: 30000,
};

export function init(config: HoConfig = {}): void {
	const resource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: config.serviceName ?? "ho-agent",
	});

	const enrichers = config.enrichers ?? [];
	const exporters = config.exporters ?? [];
	const spanProcessors = [];

	for (const exporter of exporters) {
		const enriching = new EnrichingExporter(exporter, enrichers);
		spanProcessors.push(new BatchSpanProcessor(enriching, DEFAULT_BATCH_CONFIG));
	}

	if (config.dev) {
		spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
	}

	if (exporters.length === 0 && !config.dev) {
		spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
	}

	_provider = new NodeTracerProvider({ resource, spanProcessors });
	_provider.register();

	_instrumentations = config.instrumentations ?? [];
	for (const instr of _instrumentations) {
		instr.setTracerProvider(_provider);
		instr.enable();
	}
}

export async function shutdown(): Promise<void> {
	for (const instr of _instrumentations) {
		instr.disable();
	}
	_instrumentations = [];

	if (_provider) {
		await _provider.shutdown();
		_provider = undefined;
	}
}
