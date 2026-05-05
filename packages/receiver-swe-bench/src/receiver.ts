import type { Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { ReceiverAdapter } from "@ho/sdk";
import { HoAttributes } from "@ho/sdk";
import { parseReport } from "./parser.js";
import type { SWEBenchReport } from "./types.js";

export class SWEBenchReceiver implements ReceiverAdapter {
	readonly name = "swe-bench";
	private tracer: Tracer | undefined;

	init(tracer: Tracer): void {
		this.tracer = tracer;
	}

	ingest(data: unknown): void {
		if (!this.tracer) {
			throw new Error("SWEBenchReceiver not initialized: call init() first");
		}

		const report = parseReport(data);
		this.createSpans(report);
	}

	private createSpans(report: SWEBenchReport): void {
		const tracer = this.tracer!;
		const resolvedCount = report.instances.filter((i) => i.resolved).length;

		tracer.startActiveSpan(
			`eval/run ${report.run_id}`,
			{
				kind: SpanKind.INTERNAL,
				attributes: {
					"gen_ai.operation.name": "eval_run",
					[HoAttributes.EVAL_RUN_ID]: report.run_id,
					[HoAttributes.EVAL_DATASET]: report.dataset ?? "swe-bench",
					"gen_ai.request.model": report.model,
					"ho.eval.total_samples": report.instances.length,
					"ho.eval.resolved_count": resolvedCount,
					"ho.eval.resolve_rate": report.instances.length > 0
						? resolvedCount / report.instances.length
						: 0,
				},
			},
			(runSpan) => {
				for (const instance of report.instances) {
					const ctx = trace.setSpan(context.active(), runSpan);
					context.with(ctx, () => {
						tracer.startActiveSpan(
							`eval/sample ${instance.instance_id}`,
							{
								kind: SpanKind.INTERNAL,
								attributes: {
									"gen_ai.operation.name": "eval_sample",
									[HoAttributes.EVAL_SAMPLE_ID]: instance.instance_id,
									[HoAttributes.EVAL_SCORE]: instance.resolved ? 1 : 0,
									...(instance.duration_ms !== undefined
										? { [HoAttributes.SANDBOX_DURATION_MS]: instance.duration_ms }
										: {}),
									...(instance.timed_out !== undefined
										? { [HoAttributes.SANDBOX_TIMED_OUT]: instance.timed_out }
										: {}),
									...(instance.patch_applied !== undefined
										? { "ho.eval.patch_applied": instance.patch_applied }
										: {}),
								},
							},
							(sampleSpan) => {
								if (!instance.resolved && instance.error) {
									sampleSpan.setStatus({ code: SpanStatusCode.ERROR, message: instance.error });
								}
								sampleSpan.end();
							},
						);
					});
				}
				runSpan.end();
			},
		);
	}
}
