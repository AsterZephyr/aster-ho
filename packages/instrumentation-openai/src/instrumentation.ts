import { performance } from "node:perf_hooks";
import type { Span } from "@opentelemetry/api";
import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import {
	InstrumentationBase,
	InstrumentationNodeModuleDefinition,
} from "@opentelemetry/instrumentation";
import type { InstrumentationConfig } from "@opentelemetry/instrumentation";
import { SUPPRESS_INSTRUMENTATION_KEY } from "@ho/sdk";
import { requestAttributes, responseAttributes } from "./attributes.js";
import { wrapStream } from "./wrap-stream.js";

export interface OpenAIInstrumentationConfig extends InstrumentationConfig {
	captureContent?: boolean;
}

export class OpenAIInstrumentation extends InstrumentationBase<OpenAIInstrumentationConfig> {
	constructor(config: OpenAIInstrumentationConfig = {}) {
		super("@ho/instrumentation-openai", "0.1.0", config);
	}

	protected init() {
		return new InstrumentationNodeModuleDefinition(
			"openai",
			[">=4 <7"],
			(exports) => {
				const Completions = exports?.Chat?.Completions ?? exports?.OpenAI?.Chat?.Completions;
				if (Completions?.prototype?.create) {
					this._wrap(Completions.prototype, "create", this._patchCreate());
				}
				return exports;
			},
			(exports) => {
				const Completions = exports?.Chat?.Completions ?? exports?.OpenAI?.Chat?.Completions;
				if (Completions?.prototype?.create) {
					this._unwrap(Completions.prototype, "create");
				}
			},
		);
	}

	private _patchCreate() {
		const instrumentation = this;
		return (original: (...args: unknown[]) => unknown) => {
			return function patchedCreate(this: unknown, ...args: unknown[]) {
				if (context.active().getValue(SUPPRESS_INSTRUMENTATION_KEY)) {
					return original.apply(this, args);
				}

				const body = (args[0] ?? {}) as Record<string, unknown>;
				const model = String(body.model ?? "unknown");
				const isStream = body.stream === true;

				const span = instrumentation.tracer.startSpan(
					`chat ${model}`,
					{
						kind: SpanKind.CLIENT,
						attributes: requestAttributes(body),
					},
				);

				if (isStream) {
					return instrumentation._handleStream(original, this, args, span);
				}
				return instrumentation._handleSync(original, this, args, span);
			};
		};
	}

	private _handleSync(
		original: (...args: unknown[]) => unknown,
		thisArg: unknown,
		args: unknown[],
		span: Span,
	) {
		const activeCtx = trace.setSpan(context.active(), span);
		return context.with(activeCtx, () => {
			const result = original.apply(thisArg, args);
			if (result && typeof (result as Promise<unknown>).then === "function") {
				return (result as Promise<Record<string, unknown>>)
					.then((response) => {
						span.setAttributes(responseAttributes(response));
						span.end();
						return response;
					})
					.catch((err: Error) => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
						span.end();
						throw err;
					});
			}
			span.end();
			return result;
		});
	}

	private _handleStream(
		original: (...args: unknown[]) => unknown,
		thisArg: unknown,
		args: unknown[],
		span: Span,
	) {
		const activeCtx = trace.setSpan(context.active(), span);
		return context.with(activeCtx, () => {
			const result = original.apply(thisArg, args);
			if (result && typeof (result as Promise<unknown>).then === "function") {
				return (result as Promise<AsyncIterable<unknown>>).then((stream) => {
					return wrapStream(stream, { span, startTime: performance.now() });
				});
			}
			return wrapStream(result as AsyncIterable<unknown>, { span, startTime: performance.now() });
		});
	}
}
