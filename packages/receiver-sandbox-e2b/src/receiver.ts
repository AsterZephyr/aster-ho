import type { Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { ReceiverAdapter } from "@ho/sdk";
import { GenAIAttributes, HoAttributes } from "@ho/sdk";
import type { E2BSandboxConfig, E2BSandboxEvent } from "./types.js";

export class E2BSandboxReceiver implements ReceiverAdapter {
	readonly name = "sandbox-e2b";
	private tracer: Tracer | undefined;
	private readonly config: E2BSandboxConfig;

	constructor(config: E2BSandboxConfig = {}) {
		this.config = config;
	}

	init(tracer: Tracer): void {
		this.tracer = tracer;
	}

	ingest(data: unknown): void {
		if (!this.tracer) {
			throw new Error("E2BSandboxReceiver not initialized: call init() first");
		}

		const event = data as E2BSandboxEvent;
		if (!event || typeof event !== "object" || !event.sandbox_id) {
			throw new Error("Invalid E2B sandbox event: missing sandbox_id");
		}

		this.createSpan(event);
	}

	private createSpan(event: E2BSandboxEvent): void {
		const tracer = this.tracer!;
		const detail = event.command ?? event.path ?? "";
		const spanName = `sandbox/${event.action} ${detail.split(" ")[0] ?? ""}`.trim();

		const parentCtx = event.trace_id && event.span_id
			? trace.setSpanContext(context.active(), {
					traceId: event.trace_id,
					spanId: event.span_id,
					traceFlags: 1,
					isRemote: true,
				})
			: context.active();

		context.with(parentCtx, () => {
			tracer.startActiveSpan(
				spanName,
				{
					kind: SpanKind.INTERNAL,
					attributes: {
						"gen_ai.operation.name": "execute_tool",
						[GenAIAttributes.TOOL_NAME]: `sandbox.${event.action}`,
						...(event.command ? { [GenAIAttributes.TOOL_CALL_ARGUMENTS]: event.command } : {}),
						...(event.path ? { [GenAIAttributes.TOOL_CALL_ARGUMENTS]: event.path } : {}),
						[HoAttributes.SANDBOX_TYPE]: "e2b",
						[HoAttributes.SANDBOX_ID]: event.sandbox_id,
						[HoAttributes.SANDBOX_DURATION_MS]: event.duration_ms,
						...(event.exit_code !== undefined ? { [HoAttributes.SANDBOX_EXIT_CODE]: event.exit_code } : {}),
					},
				},
				(span) => {
					if (event.error) {
						span.setStatus({ code: SpanStatusCode.ERROR, message: event.error });
					} else if (event.exit_code !== undefined && event.exit_code !== 0) {
						span.setStatus({ code: SpanStatusCode.ERROR, message: `exit code ${event.exit_code}` });
					}
					span.end();
				},
			);
		});
	}
}
