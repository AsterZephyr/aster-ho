import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { Span, Tracer } from "@opentelemetry/api";
import { GenAIAttributes, HoAttributes } from "./types.js";

export class AgentLoopTimeoutError extends Error {
	constructor(timeout: number) {
		super(`Agent loop timed out after ${timeout}ms`);
		this.name = "AgentLoopTimeoutError";
	}
}

export class AgentLoopMaxIterationsError extends Error {
	constructor(max: number) {
		super(`Agent loop exceeded max iterations (${max})`);
		this.name = "AgentLoopMaxIterationsError";
	}
}

export interface AgentLoopContext {
	span: Span;
	iteration: number;
	done: boolean;
	output: unknown;
	finish(output: unknown): void;
	traceTool(name: string, fn: () => Promise<unknown>): Promise<unknown>;
}

export interface AgentLoopOptions {
	maxIterations?: number;
	timeout?: number;
}

export async function withAgentLoop<T>(
	agentName: string,
	fn: (loop: AgentLoopContext) => Promise<T>,
	opts?: AgentLoopOptions,
): Promise<T> {
	const tracer = trace.getTracer("@ho/sdk", "0.1.0");

	return tracer.startActiveSpan(
		`invoke_agent ${agentName}`,
		{
			kind: SpanKind.INTERNAL,
			attributes: {
				[GenAIAttributes.OPERATION_NAME]: "invoke_agent",
				[GenAIAttributes.AGENT_NAME]: agentName,
			},
		},
		async (rootSpan) => {
			const rootCtx = trace.setSpan(context.active(), rootSpan);

			let timer: ReturnType<typeof setTimeout> | undefined;
			let aborted = false;

			if (opts?.timeout) {
				timer = setTimeout(() => {
					aborted = true;
				}, opts.timeout);
			}

			const loop: AgentLoopContext = {
				span: rootSpan,
				iteration: 0,
				done: false,
				output: undefined,

				finish(output: unknown) {
					this.done = true;
					this.output = output;
				},

				async traceTool(name: string, fn: () => Promise<unknown>) {
					return tracer.startActiveSpan(
						`execute_tool ${name}`,
						{
							kind: SpanKind.INTERNAL,
							attributes: {
								[GenAIAttributes.OPERATION_NAME]: "execute_tool",
								[GenAIAttributes.TOOL_NAME]: name,
							},
						},
						rootCtx,
						async (toolSpan) => {
							try {
								const result = await fn();
								toolSpan.end();
								return result;
							} catch (err) {
								toolSpan.setStatus({
									code: SpanStatusCode.ERROR,
									message: (err as Error).message,
								});
								toolSpan.end();
								throw err;
							}
						},
					);
				},
			};

			const checkLimits = () => {
				if (aborted) {
					throw new AgentLoopTimeoutError(opts?.timeout!);
				}
				if (opts?.maxIterations && loop.iteration >= opts.maxIterations) {
					throw new AgentLoopMaxIterationsError(opts.maxIterations);
				}
			};

			const originalTraceTool = loop.traceTool.bind(loop);
			loop.traceTool = async (name, fn) => {
				checkLimits();
				return originalTraceTool(name, fn);
			};

			try {
				const result = await fn(loop);
				rootSpan.setAttribute(HoAttributes.AGENT_ITERATIONS, loop.iteration);
				rootSpan.end();
				return result;
			} catch (err) {
				rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
				rootSpan.setAttribute(HoAttributes.AGENT_ITERATIONS, loop.iteration);
				rootSpan.end();
				throw err;
			} finally {
				if (timer) clearTimeout(timer);
			}
		},
	);
}
