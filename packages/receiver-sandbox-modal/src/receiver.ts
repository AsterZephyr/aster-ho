import type { Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { ReceiverAdapter } from "@ho/sdk";
import { GenAIAttributes, HoAttributes } from "@ho/sdk";
import type { ModalContainerEvent } from "./types.js";

export class ModalSandboxReceiver implements ReceiverAdapter {
	readonly name = "sandbox-modal";
	private tracer: Tracer | undefined;

	init(tracer: Tracer): void {
		this.tracer = tracer;
	}

	ingest(data: unknown): void {
		if (!this.tracer) {
			throw new Error("ModalSandboxReceiver not initialized: call init() first");
		}

		const event = data as ModalContainerEvent;
		if (!event || typeof event !== "object" || !event.container_id) {
			throw new Error("Invalid Modal container event: missing container_id");
		}

		this.createSpan(event);
	}

	private createSpan(event: ModalContainerEvent): void {
		const tracer = this.tracer!;
		const detail = event.command?.split(" ")[0] ?? event.function_name;
		const spanName = `sandbox/${event.action} ${detail}`.trim();

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
						[HoAttributes.SANDBOX_TYPE]: "modal",
						[HoAttributes.SANDBOX_ID]: event.container_id,
						[HoAttributes.SANDBOX_DURATION_MS]: event.duration_ms,
						"ho.sandbox.function_name": event.function_name,
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
