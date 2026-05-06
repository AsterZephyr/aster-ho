import type { ReceiverAdapter } from "@ho/sdk";
import { GenAIAttributes, HoAttributes } from "@ho/sdk";
import type { Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { DockerExecEvent, DockerSandboxConfig } from "./types.js";

export class DockerSandboxReceiver implements ReceiverAdapter {
	readonly name = "sandbox-docker";
	private tracer: Tracer | undefined;
	private readonly config: DockerSandboxConfig;

	constructor(config: DockerSandboxConfig = {}) {
		this.config = config;
	}

	init(tracer: Tracer): void {
		this.tracer = tracer;
	}

	ingest(data: unknown): void {
		if (!this.tracer) {
			throw new Error("DockerSandboxReceiver not initialized: call init() first");
		}

		const event = data as DockerExecEvent;
		if (!event || typeof event !== "object" || !event.container_id) {
			throw new Error("Invalid Docker exec event: missing container_id");
		}

		if (this.config.containerFilter?.length) {
			const match = this.config.containerFilter.some(
				(f) => event.container_id === f || event.container_name === f,
			);
			if (!match) return;
		}

		this.createSpan(event);
	}

	private createSpan(event: DockerExecEvent): void {
		const tracer = this.tracer!;
		const cmdName = event.command.split(" ")[0] ?? "";

		const parentCtx =
			event.trace_id && event.span_id
				? trace.setSpanContext(context.active(), {
						traceId: event.trace_id,
						spanId: event.span_id,
						traceFlags: 1,
						isRemote: true,
					})
				: context.active();

		context.with(parentCtx, () => {
			tracer.startActiveSpan(
				`sandbox/exec ${cmdName}`.trim(),
				{
					kind: SpanKind.INTERNAL,
					attributes: {
						"gen_ai.operation.name": "execute_tool",
						[GenAIAttributes.TOOL_NAME]: "sandbox.exec",
						[GenAIAttributes.TOOL_CALL_ARGUMENTS]: event.command,
						[HoAttributes.SANDBOX_TYPE]: "docker",
						[HoAttributes.SANDBOX_ID]: event.container_id,
						[HoAttributes.SANDBOX_EXIT_CODE]: event.exit_code,
						[HoAttributes.SANDBOX_DURATION_MS]: event.duration_ms,
						...(event.timed_out !== undefined
							? { [HoAttributes.SANDBOX_TIMED_OUT]: event.timed_out }
							: {}),
						...(event.container_name ? { "ho.sandbox.container_name": event.container_name } : {}),
					},
				},
				(span) => {
					if (event.exit_code !== 0) {
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: event.stderr ?? `exit code ${event.exit_code}`,
						});
					}
					span.end();
				},
			);
		});
	}
}
