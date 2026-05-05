import type { Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { ReceiverAdapter } from "@ho/sdk";
import { GenAIAttributes, HoAttributes } from "@ho/sdk";
import { parseScoreLog } from "./parser.js";
import type { METRScoreLog } from "./types.js";

export class METRReceiver implements ReceiverAdapter {
	readonly name = "metr";
	private tracer: Tracer | undefined;

	init(tracer: Tracer): void {
		this.tracer = tracer;
	}

	ingest(data: unknown): void {
		if (!this.tracer) {
			throw new Error("METRReceiver not initialized: call init() first");
		}
		const log = parseScoreLog(data);
		this.createSpans(log);
	}

	private createSpans(log: METRScoreLog): void {
		const tracer = this.tracer!;

		tracer.startActiveSpan(
			`eval/run ${log.task_id}`,
			{
				kind: SpanKind.INTERNAL,
				attributes: {
					"gen_ai.operation.name": "eval_run",
					[HoAttributes.EVAL_RUN_ID]: log.run_id,
					[HoAttributes.EVAL_DATASET]: log.task_id,
					[GenAIAttributes.AGENT_NAME]: log.agent,
					"ho.eval.duration_s": log.duration_s,
				},
			},
			(runSpan) => {
				// Score span
				const scoreCtx = trace.setSpan(context.active(), runSpan);
				context.with(scoreCtx, () => {
					tracer.startActiveSpan(
						"eval/score",
						{
							kind: SpanKind.INTERNAL,
							attributes: {
								"gen_ai.operation.name": "eval_score",
								[HoAttributes.EVAL_SCORE]: log.score,
								"ho.eval.max_score": log.max_score,
								"ho.eval.normalized_score": log.max_score > 0 ? log.score / log.max_score : 0,
							},
						},
						(scoreSpan) => {
							if (log.intermediate_scores) {
								for (const is of log.intermediate_scores) {
									scoreSpan.addEvent("intermediate_score", {
										"ho.eval.score": is.value,
										...(is.message ? { "ho.eval.message": is.message } : {}),
									});
								}
							}
							scoreSpan.end();
						},
					);
				});

				// Exec result spans
				for (const exec of log.exec_results) {
					const execCtx = trace.setSpan(context.active(), runSpan);
					context.with(execCtx, () => {
						tracer.startActiveSpan(
							`sandbox/exec ${exec.command.split(" ")[0] ?? ""}`.trim(),
							{
								kind: SpanKind.INTERNAL,
								attributes: {
									"gen_ai.operation.name": "execute_tool",
									[GenAIAttributes.TOOL_NAME]: "sandbox.exec",
									[GenAIAttributes.TOOL_CALL_ARGUMENTS]: exec.command,
									[HoAttributes.SANDBOX_TYPE]: "metr",
									[HoAttributes.SANDBOX_EXIT_CODE]: exec.exit_code,
									[HoAttributes.SANDBOX_DURATION_MS]: exec.duration_ms,
								},
							},
							(execSpan) => {
								if (exec.exit_code !== 0) {
									execSpan.setStatus({
										code: SpanStatusCode.ERROR,
										message: exec.stderr ?? `exit code ${exec.exit_code}`,
									});
								}
								execSpan.end();
							},
						);
					});
				}

				runSpan.end();
			},
		);
	}
}
