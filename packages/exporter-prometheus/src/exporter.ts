import { type Server, createServer } from "node:http";
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { Aggregator } from "./aggregator.js";
import { convertSpans } from "./connector.js";
import type { PrometheusConfig } from "./types.js";

export class PrometheusExporter implements SpanExporter {
	private readonly aggregator: Aggregator;
	private readonly config: Required<Pick<PrometheusConfig, "port" | "path" | "prefix">> &
		PrometheusConfig;
	private server: Server | undefined;

	constructor(config: PrometheusConfig) {
		this.config = {
			port: 9464,
			path: "/metrics",
			prefix: "ho_",
			...config,
		};
		this.aggregator = new Aggregator();

		for (const metric of this.config.metrics) {
			if (metric.type === "histogram" && metric.buckets) {
				this.aggregator.configureBuckets(metric.name, metric.buckets);
			}
		}
	}

	export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
		try {
			const dimensions = this.config.dimensions ?? ["gen_ai.request.model"];
			const samples = convertSpans(spans, this.config.metrics, dimensions);
			this.aggregator.push(samples);
			resultCallback({ code: ExportResultCode.SUCCESS });
		} catch {
			resultCallback({ code: ExportResultCode.FAILED });
		}
	}

	async start(): Promise<void> {
		if (this.server) return;

		this.server = createServer((req, res) => {
			if (req.url === this.config.path && req.method === "GET") {
				const body = this.aggregator.serialize(this.config.prefix);
				res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
				res.end(body);
			} else {
				res.writeHead(404);
				res.end();
			}
		});

		await new Promise<void>((resolve) => {
			this.server?.listen(this.config.port, resolve);
		});
	}

	async shutdown(): Promise<void> {
		if (!this.server) return;
		await new Promise<void>((resolve) => {
			this.server?.close(() => resolve());
		});
		this.server = undefined;
	}

	forceFlush(): Promise<void> {
		return Promise.resolve();
	}

	getMetricsOutput(): string {
		return this.aggregator.serialize(this.config.prefix);
	}
}
