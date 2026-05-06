import { performance } from "node:perf_hooks";
import { SUPPRESS_INSTRUMENTATION_KEY } from "@ho/sdk";
import type { Span } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import {
	InstrumentationBase,
	InstrumentationNodeModuleDefinition,
} from "@opentelemetry/instrumentation";
import type { InstrumentationConfig } from "@opentelemetry/instrumentation";
import { requestAttributes, responseAttributes } from "./attributes.js";
import { wrapStream } from "./wrap-stream.js";

export interface AnthropicInstrumentationConfig extends InstrumentationConfig {
	captureContent?: boolean;
}

export class AnthropicInstrumentation extends InstrumentationBase<AnthropicInstrumentationConfig> {
	constructor(config: AnthropicInstrumentationConfig = {}) {
		super("@ho/instrumentation-anthropic", "0.1.0", config);
	}

	protected init() {
		return new InstrumentationNodeModuleDefinition(
			"@anthropic-ai/sdk",
			[">=0.30.0"],
			(exports) => {
				const Messages = exports?.Messages ?? exports?.Anthropic?.Messages;
				if (Messages?.prototype?.create) {
					this._wrap(Messages.prototype, "create", this._patchCreate());
				}
				return exports;
			},
			(exports) => {
				const Messages = exports?.Messages ?? exports?.Anthropic?.Messages;
				if (Messages?.prototype?.create) {
					this._unwrap(Messages.prototype, "create");
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

				const span = instrumentation.tracer.startSpan(`chat ${model}`, {
					kind: SpanKind.CLIENT,
					attributes: requestAttributes(body),
				});

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
