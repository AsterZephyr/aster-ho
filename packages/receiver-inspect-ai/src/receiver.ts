import type { ReceiverAdapter } from "@ho/sdk";
import { GenAIAttributes, HoAttributes } from "@ho/sdk";
import type { Attributes, Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import { parseEvalLog } from "./parser.js";
import type { InspectEvalLog, InspectEvent, InspectSample } from "./types.js";

export class InspectAIReceiver implements ReceiverAdapter {
	readonly name = "inspect-ai";
	private tracer: Tracer | undefined;

	init(tracer: Tracer): void {
		this.tracer = tracer;
	}

	ingest(data: unknown): void {
		if (!this.tracer) {
			throw new Error("InspectAIReceiver not initialized: call init() first");
		}
		const log = parseEvalLog(data);
		this.createSpans(log);
	}

	private createSpans(log: InspectEvalLog): void {
		const tracer = this.tracer!;

		tracer.startActiveSpan(
			`eval/run ${log.eval.task}`,
			{
				kind: SpanKind.INTERNAL,
				attributes: {
					"gen_ai.operation.name": "eval_run",
					[HoAttributes.EVAL_RUN_ID]: log.eval.run_id,
					[HoAttributes.EVAL_DATASET]: log.eval.task,
					[GenAIAttributes.REQUEST_MODEL]: log.eval.model,
					"ho.eval.total_samples": log.samples.length,
				},
			},
			(runSpan) => {
				for (const sample of log.samples) {
					const ctx = trace.setSpan(context.active(), runSpan);
					context.with(ctx, () => this.createSampleSpan(tracer, sample));
				}
				runSpan.end();
			},
		);
	}

	private createSampleSpan(tracer: Tracer, sample: InspectSample): void {
		tracer.startActiveSpan(
			`eval/sample ${sample.id}`,
			{
				kind: SpanKind.INTERNAL,
				attributes: {
					"gen_ai.operation.name": "eval_sample",
					[HoAttributes.EVAL_SAMPLE_ID]: sample.id,
				},
			},
			(sampleSpan) => {
				for (const event of sample.events) {
					const ctx = trace.setSpan(context.active(), sampleSpan);
					context.with(ctx, () => this.createEventSpan(tracer, event));
				}
				sampleSpan.end();
			},
		);
	}

	private createEventSpan(tracer: Tracer, event: InspectEvent): void {
		const spanName = this.eventSpanName(event);
		const attributes: Attributes = {};

		if (event.type === "model") {
			attributes["gen_ai.operation.name"] = "chat";
			if (event.model) attributes[GenAIAttributes.REQUEST_MODEL] = event.model;
			if (event.input_tokens !== undefined)
				attributes[GenAIAttributes.USAGE_INPUT_TOKENS] = event.input_tokens;
			if (event.output_tokens !== undefined)
				attributes[GenAIAttributes.USAGE_OUTPUT_TOKENS] = event.output_tokens;
		} else if (event.type === "tool") {
			attributes["gen_ai.operation.name"] = "execute_tool";
			if (event.tool_name) attributes[GenAIAttributes.TOOL_NAME] = event.tool_name;
		} else if (event.type === "sandbox") {
			attributes["gen_ai.operation.name"] = "execute_tool";
			attributes[GenAIAttributes.TOOL_NAME] = "sandbox.exec";
			if (event.command) attributes[GenAIAttributes.TOOL_CALL_ARGUMENTS] = event.command;
			if (event.exit_code !== undefined)
				attributes[HoAttributes.SANDBOX_EXIT_CODE] = event.exit_code;
		}

		tracer.startActiveSpan(spanName, { kind: SpanKind.INTERNAL, attributes }, (span) => {
			if (event.error) {
				span.setStatus({ code: SpanStatusCode.ERROR, message: event.error });
			}
			span.end();
		});
	}

	private eventSpanName(event: InspectEvent): string {
		switch (event.type) {
			case "model":
				return `chat ${event.model ?? "unknown"}`;
			case "tool":
				return `tool/${event.tool_name ?? "unknown"}`;
			case "sandbox":
				return "sandbox/exec";
			case "score":
				return "eval/score";
			default:
				return `event/${event.type}`;
		}
	}
}
