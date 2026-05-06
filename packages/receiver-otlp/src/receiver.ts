import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { decodeOtlpRequest } from "./decoder.js";
import type { ExportTraceServiceRequest, OtlpReceiverConfig } from "./types.js";

export class OtlpReceiver {
	readonly name = "otlp";
	private server: Server | undefined;
	private readonly configPort: number;
	private readonly host: string;
	private readonly path: string;
	private readonly maxBodySize: number;
	private actualPort = 0;

	constructor(private readonly config: OtlpReceiverConfig = {}) {
		this.configPort = config.port ?? 4318;
		this.host = config.host ?? "0.0.0.0";
		this.path = config.path ?? "/v1/traces";
		this.maxBodySize = config.maxBodySize ?? 4 * 1024 * 1024;
	}

	async start(pipeline: SpanExporter): Promise<void> {
		this.server = createServer((req, res) => {
			if (req.method !== "POST" || req.url !== this.path) {
				res.writeHead(404);
				res.end();
				return;
			}

			const chunks: Buffer[] = [];
			let size = 0;

			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > this.maxBodySize) {
					res.writeHead(413);
					res.end();
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});

			req.on("end", () => {
				try {
					const body = JSON.parse(Buffer.concat(chunks).toString()) as ExportTraceServiceRequest;
					const spans = decodeOtlpRequest(body);
					if (spans.length > 0) {
						pipeline.export(spans, () => {});
					}
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end("{}");
				} catch {
					res.writeHead(400);
					res.end('{"error":"invalid request body"}');
				}
			});
		});

		return new Promise((resolve) => {
			this.server!.listen(this.configPort, this.host, () => {
				const addr = this.server!.address() as AddressInfo;
				this.actualPort = addr.port;
				resolve();
			});
		});
	}

	async shutdown(): Promise<void> {
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => resolve());
			} else {
				resolve();
			}
		});
	}

	get address(): { port: number; host: string } {
		return { port: this.actualPort, host: this.host };
	}
}
