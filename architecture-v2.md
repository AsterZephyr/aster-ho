# Architecture v2: Build ON OTEL SDK

## 核心决策变更

**原方案**: 从头实现类 OTEL Collector 的 Receiver-Processor-Exporter pipeline engine
**新方案**: 基于 `@opentelemetry/sdk-trace-node` 构建 GenAI 专用扩展层

### 为什么

1. JS 生态**没有** OTEL Collector (只有 Go 版), 从头实现 pipeline engine 成本极高
2. OTEL TS SDK 的 `SpanProcessor` + `SpanExporter` 已覆盖 filter/transform/route 需求
3. `AsyncLocalStorage` context propagation 是 battle-tested 的, 无需重写
4. `@opentelemetry/instrumentation` 提供了完整的 monkey-patching 基础设施 (CJS + ESM)
5. GenAI span 量低 (每分钟几十-几百), SDK 性能开销可忽略
6. 直接获得所有 OTEL 后端兼容性 (Jaeger, Tempo, Datadog, Honeycomb...)

### "Receiver" 的重新定义

OTEL TS SDK 是 **producer-only** (不能接收外部 span)。我们的 "Receiver" 变为：
- **Ingest Adapter**: 轻量 HTTP server 接收外部数据 → 用 SDK 的 Tracer 创建 span → 进入正常管道
- 通过 remote parent context 关联到外部 trace (见 §Ingest 跨进程关联)

---

## 修订后的系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                    User's Agent Code                                  │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Manual API   │  │ Auto-Instru  │  │ Ingest Adapters          │  │
│  │ @trace()     │  │ (OpenAI/     │  │ (eval results, sandbox   │  │
│  │ withSpan()   │  │  Anthropic/  │  │  events, external data)  │  │
│  │ withAgent()  │  │  Gemini)     │  │                          │  │
│  │ wrapLLMCall()│  │              │  │                          │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                  │                       │                 │
│         └──────────────────┴───────────────────────┘                 │
│                            │                                         │
│              ┌─────────────▼──────────────┐                         │
│              │  OTEL TracerProvider        │  (NodeTracerProvider)   │
│              │  + AsyncLocalStorage        │                         │
│              └─────────────┬──────────────┘                         │
│                            │                                         │
│         ┌──────────────────┼──────────────────┐                     │
│         │                  │                  │                      │
│         ▼                  ▼                  ▼                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │ BatchProcessor  │  │ BatchProcessor  │  │ SimpleProcessor │    │
│  │ + Enriching     │  │ + Enriching     │  │ (console, dev)  │    │
│  │   Exporter      │  │   Exporter      │  │                 │    │
│  │  ┌───────────┐  │  │  ┌───────────┐  │  └─────────────────┘    │
│  │  │ Enrichers │  │  │  │ Enrichers │  │                          │
│  │  │ - Cost    │  │  │  │ - Cost    │  │                          │
│  │  │ - Error   │  │  │  │ - Error   │  │                          │
│  │  │ - ToolNrm │  │  │  │ - ToolNrm │  │                          │
│  │  └─────┬─────┘  │  │  └─────┬─────┘  │                          │
│  │        ▼         │  │        ▼         │                          │
│  │  ┌───────────┐   │  │  ┌───────────┐  │                          │
│  │  │ Langfuse  │   │  │  │ OTLP/HTTP │  │                          │
│  │  │ Exporter  │   │  │  │ (built-in)│  │                          │
│  │  └───────────┘   │  │  └───────────┘  │                          │
│  └─────────────────┘  └─────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

**关键设计决策**: Enrichment 发生在 Exporter 层, 不在 SpanProcessor 层。
- `SpanProcessor.onEnd()` 收到 `ReadableSpan` (不可变), 无法添加 attributes
- `EnrichingExporter` 在 `export()` 阶段做 transform, 此时数据归我们控制
- SpanProcessor 只用于: BatchSpanProcessor (batching + flush) 和 FilterSpanProcessor (采样/丢弃)

---

## 层次分解

### Layer 1: Instrumentation (数据生产)

#### 1a. Manual API (用户显式调用)

```typescript
import { trace, withSpan, withAgentLoop, wrapLLMCall, ho } from '@ho/sdk';

// 装饰器 (agent 方法边界)
class MyAgent {
  @trace({ name: 'agent.research' })
  async research(query: string) { ... }
}

// Context manager (方法内部追踪, 不抑制 auto-instrumentation)
const result = await withSpan('agent.plan', async (span) => {
  span.setAttribute('gen_ai.agent.name', 'planner');
  return await this.llm.chat(prompt);  // auto-instrumentation 正常创建子 span
});

// Agent loop (见 §Agent Loop Instrumentation)
const output = await withAgentLoop('coding-agent', async (loop) => {
  while (!loop.done) {
    const response = await openai.chat(...);  // auto → child span
    if (response.tool_calls) {
      for (const tc of response.tool_calls) {
        const result = await loop.traceTool(tc.name, () => execute(tc));
      }
    } else {
      loop.finish(response.content);
    }
  }
  return loop.output;
});

// HOF wrapper (第三方 SDK 无 auto-instrumentation 时, 设置 suppress)
const tracedCall = wrapLLMCall(customLLM.generate, { provider: 'custom' });
```

#### 1b. Auto-Instrumentation (零代码)

基于 `@opentelemetry/instrumentation` 的 `InstrumentationBase`:

```typescript
// @ho/instrumentation-openai
class OpenAIInstrumentation extends InstrumentationBase {
  protected init() {
    return new InstrumentationNodeModuleDefinition(
      'openai', ['>=4 <7'],
      (exports) => {
        this._wrap(exports.OpenAI.Chat.Completions.prototype, 'create', this.patchChat());
        return exports;
      },
      (exports) => {
        this._unwrap(exports.OpenAI.Chat.Completions.prototype, 'create');
      }
    );
  }

  private patchChat() {
    return (original: Function) => {
      const instrumentation = this;
      return function(this: any, ...args: any[]) {
        // 检查是否被 wrapLLMCall 抑制
        if (context.active().getValue(SUPPRESS_INSTRUMENTATION_KEY)) {
          return original.apply(this, args);
        }

        const isStream = args[0]?.stream === true;
        if (isStream) {
          return instrumentation.patchStreamCall(original, this, args);
        }
        return instrumentation.patchSyncCall(original, this, args);
      };
    };
  }
}

// @ho/instrumentation-anthropic
class AnthropicInstrumentation extends InstrumentationBase {
  protected init() {
    return new InstrumentationNodeModuleDefinition(
      '@anthropic-ai/sdk', ['>=0.10 <2'],
      (exports) => {
        this._wrap(exports.Anthropic.Messages.prototype, 'create', this.patchMessages());
        this._wrap(exports.Anthropic.Messages.prototype, 'stream', this.patchStream());
        return exports;
      }, ...
    );
  }
}

// @ho/instrumentation-google
class GoogleGenAIInstrumentation extends InstrumentationBase {
  protected init() {
    return new InstrumentationNodeModuleDefinition(
      '@google/generative-ai', ['>=0.1'],
      (exports) => {
        this._wrap(exports.GenerativeModel.prototype, 'generateContent', ...);
        this._wrap(exports.GenerativeModel.prototype, 'generateContentStream', ...);
        return exports;
      }, ...
    );
  }
}
```

#### 1c. Streaming Instrumentation (所有 auto-instrumentation 必须处理)

Agent 场景 80%+ 是 streaming call, 必须从第一天支持:

```typescript
// Streaming 拦截模式: wrap async iterator/ReadableStream

private patchStreamCall(original: Function, thisArg: any, args: any[]) {
  const span = this.tracer.startSpan(`chat ${args[0]?.model ?? 'unknown'}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': args[0]?.model,
      'gen_ai.request.stream': true,
    },
  });

  const startTime = performance.now();
  let firstChunkReceived = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: string | undefined;

  const originalResult = original.apply(thisArg, args);

  // 包装返回的 stream
  return wrapAsyncIterator(originalResult, {
    onChunk(chunk) {
      if (!firstChunkReceived) {
        firstChunkReceived = true;
        const ttfc = (performance.now() - startTime) / 1000;
        span.setAttribute('gen_ai.response.time_to_first_chunk', ttfc);
      }

      // 累计 token (OpenAI: 只在最后 chunk 有 usage)
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
      if (chunk.choices?.[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    },

    onEnd() {
      span.setAttributes({
        'gen_ai.usage.input_tokens': inputTokens,
        'gen_ai.usage.output_tokens': outputTokens,
        'gen_ai.response.finish_reasons': finishReason ? [finishReason] : [],
      });
      span.end();
    },

    onError(err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.end();
    },
  });
}

// wrapAsyncIterator: 透明代理 AsyncIterable, 在每个 yield 插入回调
function wrapAsyncIterator<T>(
  source: AsyncIterable<T> & { response?: Promise<Response> },
  hooks: { onChunk: (v: T) => void; onEnd: () => void; onError: (e: Error) => void },
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const iter = source[Symbol.asyncIterator]();
      return {
        async next() {
          try {
            const result = await iter.next();
            if (result.done) {
              hooks.onEnd();
            } else {
              hooks.onChunk(result.value);
            }
            return result;
          } catch (err) {
            hooks.onError(err as Error);
            throw err;
          }
        },
      };
    },
  };
}
```

**Streaming 设计约束**:
- Span start = 请求发出时刻
- Span end = stream 完全消费完毕 (包括 `iter.next()` 返回 `done:true`)
- Token usage: 从最后一个 chunk 的 `usage` 字段获取 (OpenAI); 或从 `message_stop` event (Anthropic)
- `time_to_first_chunk`: 首次 `onChunk` 回调时间 - span start 时间
- Stream 中断: span status = ERROR, message = 异常信息, span 立即 end
- 如果用户不消费 stream (提前 break): 依赖 GC finalizer 或超时兜底 end span

#### 1d. Ingest Adapters (外部数据接入)

轻量 HTTP server, 收到数据后用 Tracer 创建 span, 通过 remote parent context 关联到外部 trace:

```typescript
// @ho/ingest-server
import { trace, context, ROOT_CONTEXT, TraceFlags } from '@opentelemetry/api';

class IngestServer {
  private tracer = trace.getTracer('@ho/ingest');

  // POST /ingest/swe-bench
  handleSWEBench(report: SWEBenchReport) {
    const runSpan = this.tracer.startSpan('eval/run', {
      attributes: {
        'harness.eval.run_id': report.run_id,
        'harness.eval.dataset': 'swe-bench',
        'harness.eval.total': report.instances.length,
        'harness.eval.resolved': report.instances.filter(i => i.resolved).length,
      }
    });
    const runCtx = trace.setSpan(context.active(), runSpan);

    for (const instance of report.instances) {
      const sampleSpan = this.tracer.startSpan('eval/sample', {
        attributes: {
          'harness.eval.sample_id': instance.instance_id,
          'harness.eval.score': instance.resolved ? 1.0 : 0.0,
        }
      }, runCtx);
      sampleSpan.end();
    }
    runSpan.end();
  }

  // POST /ingest/sandbox
  // 关键: 沙箱事件带有 trace_id + span_id, 需要挂载到外部 trace
  handleSandboxEvent(event: SandboxExecutionEvent) {
    // 构造 remote parent context — 将新 span 挂到 agent 进程的 trace 上
    const parentCtx = this.buildRemoteContext(event.trace_id, event.span_id);

    const span = this.tracer.startSpan(`sandbox/${event.action}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'gen_ai.tool.name': `sandbox.${event.action}`,
        'harness.sandbox.type': event.sandbox_type,
        'harness.sandbox.id': event.sandbox_id,
        'harness.sandbox.exit_code': event.exit_code,
        'harness.sandbox.timed_out': event.timed_out,
        'harness.sandbox.command': event.command,
        'harness.sandbox.duration_ms': event.duration_ms,
      },
      startTime: new Date(event.started_at),
    }, parentCtx);

    if (event.error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: event.error });
    }
    span.end(new Date(event.completed_at));
  }

  // 从外部提供的 trace_id/span_id 构造 remote SpanContext
  private buildRemoteContext(traceId: string, spanId: string) {
    const remoteSpanContext = {
      traceId,       // 32-hex from agent process
      spanId,        // 16-hex parent span from agent process
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    };
    return trace.setSpanContext(ROOT_CONTEXT, remoteSpanContext);
  }
}
```

**Ingest 关联约束**:
- 事件 **必须** 携带 `trace_id` (32 hex), `span_id` 为可选 (无则成为 trace root)
- Agent 侧通过 `context.active()` 获取当前 span context, 传递给沙箱调用
- 如果 trace_id 不存在, ingest 创建独立 trace (不关联)

---

### Layer 2: Enrichment (数据增强)

> 之前版本将此层命名为 "Processing", 使用 SpanProcessor。
> **修正**: SpanProcessor.onEnd() 收到 ReadableSpan (不可变), 无法添加 attributes。
> Enrichment 必须发生在 Exporter 层, 使用 EnrichingExporter + Enricher 插件链。

#### 设计: EnrichingExporter + ReadableSpanWrapper

```typescript
// ReadableSpan 有方法 (spanContext(), ended getter 等),
// 不能用简单 spread — 需要委托 wrapper class

class ReadableSpanWrapper implements ReadableSpan {
  constructor(
    private readonly _inner: ReadableSpan,
    private readonly _overrideAttrs: Attributes,
  ) {}

  get name() { return this._inner.name; }
  get kind() { return this._inner.kind; }
  get spanContext() { return this._inner.spanContext; }
  get parentSpanId() { return this._inner.parentSpanId; }
  get startTime() { return this._inner.startTime; }
  get endTime() { return this._inner.endTime; }
  get status() { return this._inner.status; }
  get links() { return this._inner.links; }
  get events() { return this._inner.events; }
  get duration() { return this._inner.duration; }
  get ended() { return this._inner.ended; }
  get resource() { return this._inner.resource; }
  get instrumentationLibrary() { return this._inner.instrumentationLibrary; }
  get droppedAttributesCount() { return this._inner.droppedAttributesCount; }
  get droppedEventsCount() { return this._inner.droppedEventsCount; }
  get droppedLinksCount() { return this._inner.droppedLinksCount; }

  // 唯一覆盖: attributes
  get attributes(): Attributes {
    return this._overrideAttrs;
  }
}
```

#### EnrichingExporter

```typescript
interface SpanEnricher {
  enrich(span: ReadableSpan, attrs: Attributes): Attributes;
}

class EnrichingExporter implements SpanExporter {
  constructor(
    private inner: SpanExporter,
    private enrichers: SpanEnricher[],
  ) {}

  export(spans: ReadableSpan[], callback: (result: ExportResult) => void) {
    const enriched = spans.map(span => {
      let attrs = { ...span.attributes };
      for (const enricher of this.enrichers) {
        attrs = enricher.enrich(span, attrs);
      }
      return new ReadableSpanWrapper(span, attrs);
    });
    this.inner.export(enriched, callback);
  }

  shutdown() { return this.inner.shutdown(); }
  forceFlush() { return this.inner.forceFlush?.() ?? Promise.resolve(); }
}
```

#### 内建 Enrichers

```typescript
// Cost enricher: token -> USD
class CostEnricher implements SpanEnricher {
  constructor(private pricing: Map<string, ModelPricing>) {}

  enrich(span: ReadableSpan, attrs: Attributes): Attributes {
    const inputTokens = attrs['gen_ai.usage.input_tokens'] as number | undefined;
    if (!inputTokens) return attrs;

    const model = (attrs['gen_ai.response.model'] ?? attrs['gen_ai.request.model']) as string;
    const pricing = this.pricing.get(model);
    if (!pricing) return attrs;

    const outputTokens = (attrs['gen_ai.usage.output_tokens'] as number) ?? 0;
    const cacheRead = (attrs['gen_ai.usage.cache_read.input_tokens'] as number) ?? 0;
    const cacheCreation = (attrs['gen_ai.usage.cache_creation.input_tokens'] as number) ?? 0;

    const cost =
      (inputTokens - cacheRead) * pricing.inputPerToken +
      cacheRead * (pricing.cacheReadPerToken ?? pricing.inputPerToken * 0.1) +
      cacheCreation * (pricing.cacheCreationPerToken ?? pricing.inputPerToken * 1.25) +
      outputTokens * pricing.outputPerToken;

    return { ...attrs, 'gen_ai.usage.cost': cost };
  }
}

// Error classifier enricher
class ErrorClassifyEnricher implements SpanEnricher {
  enrich(span: ReadableSpan, attrs: Attributes): Attributes {
    if (span.status.code !== SpanStatusCode.ERROR) return attrs;

    const msg = span.status.message ?? '';
    const category = this.classify(msg, attrs);
    return { ...attrs, 'harness.error.category': category };
  }

  private classify(msg: string, attrs: Attributes): string {
    if (msg.match(/json parse|schema validation|missing required/i)) return 'invalid_arguments';
    if (msg.match(/rate limit|overloaded|503|529/i)) return 'provider_error';
    if (msg.match(/timeout|deadline exceeded/i)) return 'timeout';
    if (msg.match(/cancelled|aborted/i)) return 'user_aborted';
    if (msg.match(/context length|token limit/i)) return 'context_overflow';
    return 'unknown';
  }
}

// Tool normalize enricher
class ToolNormalizeEnricher implements SpanEnricher {
  constructor(private repairChain: RepairStrategy[] = defaultRepairChain) {}

  enrich(span: ReadableSpan, attrs: Attributes): Attributes {
    if (attrs['gen_ai.operation.name'] !== 'execute_tool') return attrs;

    const rawArgs = attrs['gen_ai.tool.call.arguments'] as string | undefined;
    if (!rawArgs || typeof rawArgs !== 'string') return attrs;

    const result = repairAndParse(rawArgs, this.repairChain);
    if (!result.success) return attrs;

    return {
      ...attrs,
      'gen_ai.tool.call.arguments': JSON.stringify(result.value),
      'harness.tool.repaired': result.repaired,
      'harness.tool.repair_strategy': result.strategyUsed ?? '',
    };
  }
}
```

#### SpanProcessor 的正确用途 (仅用于控制流)

```typescript
// SpanProcessor 在本架构中只用于:
// 1. BatchSpanProcessor — batching + 定时 flush (OTEL SDK 内建)
// 2. FilterSpanProcessor — 采样/丢弃 (我们自定义)

class FilterSpanProcessor implements SpanProcessor {
  constructor(private filter: (span: ReadableSpan) => boolean) {}

  onStart() {}

  onEnd(span: ReadableSpan) {
    // 不导出, 仅过滤: 如果不符合条件则从 batch 中移除
    // 实际上 OTEL SDK 不支持 processor 拒绝 span...
    // 所以 filter 也只能在 EnrichingExporter.export() 里做
  }

  shutdown() { return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
}

// 最终结论: 我们的自定义逻辑全在 EnrichingExporter 内
// SpanProcessor 只使用 OTEL 内建的 BatchSpanProcessor / SimpleSpanProcessor
```

---

### Layer 3: Export (数据输出)

#### LangfuseExporter (直接 OTLP/HTTP)

```typescript
class LangfuseExporter implements SpanExporter {
  private endpoint: string;
  private authHeader: string;

  constructor(config: { publicKey: string; secretKey: string; endpoint?: string }) {
    this.endpoint = `${config.endpoint ?? 'https://cloud.langfuse.com'}/api/public/otel/v1/traces`;
    this.authHeader = 'Basic ' + Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64');
  }

  export(spans: ReadableSpan[], callback: (result: ExportResult) => void) {
    const payload = this.toOTLPPayload(spans);

    fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authHeader,
      },
      body: JSON.stringify(payload),
    })
      .then(res => {
        callback({ code: res.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED });
      })
      .catch(() => callback({ code: ExportResultCode.FAILED }));
  }

  private toOTLPPayload(spans: ReadableSpan[]) {
    return {
      resourceSpans: [{
        resource: { attributes: this.resourceAttributes() },
        scopeSpans: [{
          scope: { name: '@ho/sdk', version: '0.1.0' },
          spans: spans.map(s => this.convertSpan(s)),
        }],
      }],
    };
  }

  shutdown() { return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
}
```

---

## Auto + Manual 共存机制

### 核心原理: Context 自然嵌套 (默认行为)

Manual span (`@trace`, `withSpan`) **不**抑制 auto-instrumentation。
内部 LLM 调用自动成为子 span — 这是最常见的使用模式:

```typescript
@trace({ name: 'agent.research' })            // <- manual (parent)
async research(query: string) {
  const response = await openai.chat.completions.create({  // <- auto (child, 正常创建)
    model: 'gpt-4',
    messages: [{ role: 'user', content: query }],
  });
}
```

结果 trace tree:
```
agent.research (manual, @trace)
  └── chat gpt-4 (AUTO, from OpenAIInstrumentation)
        attributes: gen_ai.usage.input_tokens=52, gen_ai.usage.output_tokens=150, ...
```

### 抑制机制: 仅 wrapLLMCall 触发

`SUPPRESS_INSTRUMENTATION_KEY` 只在 `wrapLLMCall()` 内部设置 — 此函数的语义是"我手动包了这个调用, auto 不要重复 patch":

```typescript
const SUPPRESS_INSTRUMENTATION_KEY = Symbol.for('ho.suppress_instrumentation');

// wrapLLMCall: 手动创建 span + 设置 suppress (防止 auto 重复)
function wrapLLMCall<T>(
  fn: (...args: any[]) => Promise<T>,
  opts: { provider: string; model?: string },
): (...args: any[]) => Promise<T> {
  return async function(...args: any[]) {
    return tracer.startActiveSpan(`chat ${opts.model ?? 'unknown'}`, async (span) => {
      span.setAttribute('gen_ai.provider.name', opts.provider);

      // 仅在此处设置 suppress: 这个调用已经有手动 span 了
      const suppressedCtx = context.active().setValue(SUPPRESS_INSTRUMENTATION_KEY, true);
      return context.with(suppressedCtx, async () => {
        try {
          const result = await fn(...args);
          enrichSpanFromResult(span, result);
          return result;
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          throw err;
        } finally {
          span.end();
        }
      });
    });
  };
}

// Auto-instrumentor 检查 suppress
function createPatchedMethod(original: Function, instrumentation: InstrumentationBase) {
  return function(this: any, ...args: any[]) {
    if (context.active().getValue(SUPPRESS_INSTRUMENTATION_KEY)) {
      // wrapLLMCall 已手动创建 span — 跳过 auto
      return original.apply(this, args);
    }
    // 正常创建 auto span
    return instrumentation.createAutoSpan(original, this, args);
  };
}
```

**设计约束**:
- `@trace()` — 不设 suppress, auto child spans 正常创建
- `withSpan()` — 不设 suppress, auto child spans 正常创建
- `withAgentLoop()` — 不设 suppress, 循环内 auto spans 正常创建
- `wrapLLMCall()` — 设 suppress, 因为手动和 auto 覆盖同一个 LLM 调用

---

## Agent Loop Instrumentation

Agent 最核心的运行模式: LLM → tool → LLM → tool → ... 直到 finish_reason != tool_calls。
需要专用 API 定义循环边界和内部结构:

### Trace 结构 (符合 OTEL GenAI Semconv)

```
invoke_agent coding-agent (INTERNAL, root span)      ← withAgentLoop 创建
  ├── chat gpt-4 (CLIENT, iteration 1)               ← auto-instrumentation
  ├── execute_tool read_file (INTERNAL)               ← loop.traceTool
  ├── chat gpt-4 (CLIENT, iteration 2)               ← auto-instrumentation
  ├── execute_tool write_file (INTERNAL)              ← loop.traceTool
  └── chat gpt-4 (CLIENT, iteration 3, final)        ← auto-instrumentation
```

关键: 循环内所有 LLM/tool span 是 **同级兄弟** (parent = invoke_agent root), 不是深层嵌套。

### API 设计

```typescript
interface AgentLoopContext {
  span: Span;              // invoke_agent root span
  iteration: number;       // 当前循环轮次
  done: boolean;           // 是否结束
  output: unknown;         // 最终输出
  finish(output: unknown): void;
  traceTool(name: string, fn: () => Promise<unknown>): Promise<unknown>;
}

async function withAgentLoop<T>(
  agentName: string,
  fn: (loop: AgentLoopContext) => Promise<T>,
  opts?: { maxIterations?: number; timeout?: number },
): Promise<T> {
  return tracer.startActiveSpan(
    `invoke_agent ${agentName}`,
    { kind: SpanKind.INTERNAL, attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.name': agentName,
    }},
    async (rootSpan) => {
      const loop: AgentLoopContext = {
        span: rootSpan,
        iteration: 0,
        done: false,
        output: undefined,
        finish(output) {
          this.done = true;
          this.output = output;
        },
        async traceTool(name: string, fn: () => Promise<unknown>) {
          return tracer.startActiveSpan(
            `execute_tool ${name}`,
            { kind: SpanKind.INTERNAL, attributes: {
              'gen_ai.operation.name': 'execute_tool',
              'gen_ai.tool.name': name,
            }},
            async (toolSpan) => {
              try {
                const result = await fn();
                toolSpan.end();
                return result;
              } catch (err) {
                toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
                toolSpan.end();
                throw err;
              }
            },
            // parent = rootSpan (not current active), 保持扁平结构
            trace.setSpan(context.active(), rootSpan),
          );
        },
      };

      try {
        const result = await fn(loop);
        rootSpan.setAttribute('harness.agent.iterations', loop.iteration);
        rootSpan.end();
        return result;
      } catch (err) {
        rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        rootSpan.end();
        throw err;
      }
    },
  );
}
```

**设计决策**:
- `traceTool()` 显式用 rootSpan 作为 parent context → 保证扁平结构
- Auto-instrumented LLM calls 在 rootSpan context 下自动成为其子 span
- `iteration` 计数器在每次 LLM 调用前自增 (由 auto-instrumentation 的 onStart 回调触发)
- 超时/max_iterations 通过 AbortController 实现

---

## Tool Normalization 独立包设计

基于 Vercel AI SDK 的模式, 但更适合 observability 场景:

```typescript
// @ho/tool-normalize — 可独立使用, 不依赖 ho 追踪

// 1. 统一 Schema 定义 (内部格式)
interface UnifiedToolDefinition {
  name: string;
  description?: string;
  parameters: JSONSchema7;    // JSON Schema 7 作为公约数
  strict?: boolean;
}

// 2. 统一 Tool Call (从模型响应解析后)
interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;  // 已解析为 object
  raw?: string;                        // 原始字符串 (调试)
  repaired?: boolean;                  // 是否经过修复
  provider: 'openai' | 'anthropic' | 'gemini';
}

// 3. Provider Adapters
interface ToolSchemaAdapter {
  // Schema: 内部格式 -> provider API 格式
  encodeDefinitions(tools: UnifiedToolDefinition[]): unknown;

  // Response: provider 响应 -> 统一格式
  decodeToolCalls(response: unknown): UnifiedToolCall[];

  // Result: 统一结果 -> provider 消息格式
  encodeResults(results: UnifiedToolResult[]): unknown;
}

// 4. Repair (Vercel AI SDK 不内建, 我们内建)
const defaultRepairChain: RepairStrategy[] = [
  doubleSerializedJson,    // OpenAI 双重序列化
  markdownWrappedJson,     // Claude ```json ... ```
  trailingCommaJson,       // 尾逗号
  singleQuotedJson,        // 单引号
  emptyToEmptyObject,      // "" -> {}
];

function repairAndParse(raw: string, strategies: RepairStrategy[]): ParseResult {
  // 先尝试直接 JSON.parse
  // 失败则依次尝试 repair strategies
  // 返回 { success, value, repaired, strategy_used }
}
```

**与 Vercel AI SDK 的关键差异**:
- Vercel: 所有 tool call input 在中间层是 **string** (然后 parse+validate)
- 我们: 中间层是 **object** (已解析), 保留原始 string 做 observability
- Vercel: repair 是用户提供的 callback
- 我们: 内建 repair chain + 用户可扩展
- Vercel: 嵌入在整个 AI SDK 中
- 我们: **完全独立包**, 可单独 npm install 使用

---

## 修订后的 Package Structure

```
ho/
├── packages/
│   ├── sdk/                           # 核心 SDK (用户主入口)
│   │   ├── src/
│   │   │   ├── init.ts               # ho.init() — 配置 TracerProvider + enrichers
│   │   │   ├── trace.ts              # @trace 装饰器
│   │   │   ├── with-span.ts          # withSpan() context manager
│   │   │   ├── with-agent-loop.ts    # withAgentLoop() agent loop boundary
│   │   │   ├── wrap.ts              # wrapLLMCall() HOF (设置 suppress)
│   │   │   ├── enriching-exporter.ts # EnrichingExporter + ReadableSpanWrapper
│   │   │   ├── eval.ts              # ho.startEvalRun() 便利 API
│   │   │   └── types.ts             # GenAI attribute constants
│   │   ├── package.json             # deps: @opentelemetry/api, @opentelemetry/sdk-trace-node
│   │   └── tsconfig.json
│   │
│   ├── tool-normalize/               # 独立工具规范化包
│   │   ├── src/
│   │   │   ├── types.ts             # UnifiedToolDefinition, UnifiedToolCall, UnifiedToolResult
│   │   │   ├── adapters/
│   │   │   │   ├── openai.ts        # OpenAI adapter
│   │   │   │   ├── anthropic.ts     # Anthropic adapter
│   │   │   │   └── gemini.ts        # Gemini adapter (含 JSON Schema -> OpenAPI 转换)
│   │   │   ├── repair.ts            # Repair chain
│   │   │   ├── validate.ts          # Schema validation
│   │   │   └── index.ts
│   │   └── package.json             # 零依赖 (除了 JSON Schema types)
│   │
│   ├── enrichers/                     # Enricher 插件 (插入 EnrichingExporter)
│   │   ├── enricher-cost/            # Token -> USD 计算
│   │   ├── enricher-error-classify/  # 错误分类
│   │   └── enricher-tool-normalize/  # 基于 tool-normalize 包的 enricher wrapper
│   │
│   ├── exporters/
│   │   ├── exporter-langfuse/        # 直接 OTLP/HTTP -> Langfuse
│   │   └── exporter-file/           # JSONL 本地持久化
│   │
│   ├── instrumentations/             # Auto-instrumentation (各自独立, tree-shakeable)
│   │   ├── openai/                   # @ho/instrumentation-openai
│   │   ├── anthropic/               # @ho/instrumentation-anthropic
│   │   ├── google/                  # @ho/instrumentation-google
│   │   └── vercel-ai/              # @ho/instrumentation-vercel-ai
│   │
│   └── ingest/                       # 外部数据接入服务
│       ├── src/
│       │   ├── server.ts            # HTTP server (Fastify/Hono)
│       │   ├── adapters/
│       │   │   ├── swe-bench.ts     # SWE-bench report.json 解析
│       │   │   ├── inspect-ai.ts    # Inspect AI EvalLog 解析
│       │   │   ├── metr.ts          # METR ScoreLog 解析
│       │   │   ├── docker.ts        # Docker events 订阅
│       │   │   └── e2b.ts           # E2B SDK hook
│       │   └── index.ts
│       └── package.json
│
├── examples/
│   ├── basic-manual/                 # 纯手动 API 示例
│   ├── auto-openai/                  # Auto-instrumentation 示例
│   ├── auto-openai-streaming/        # Streaming auto-instrumentation
│   ├── agent-loop/                   # withAgentLoop 完整 agent 示例
│   ├── combined-agent/               # Manual + Auto 混合
│   ├── eval-swe-bench/              # SWE-bench 结果接入
│   └── langfuse-export/             # Langfuse 导出示例
│
├── tsconfig.json
├── turbo.json
└── package.json
```

---

## 初始化 API 设计

```typescript
import { ho } from '@ho/sdk';

// 最简初始化 (零配置开始)
ho.init();  // Console exporter, 无 auto-instrumentation

// 完整初始化
ho.init({
  serviceName: 'my-coding-agent',

  // Auto-instrumentation
  instrumentations: [
    new OpenAIInstrumentation({ captureContent: true }),
    new AnthropicInstrumentation(),
  ],

  // Enrichers (插入每个 EnrichingExporter)
  enrichers: [
    new CostEnricher({ pricing: defaultPricing }),
    new ErrorClassifyEnricher(),
    new ToolNormalizeEnricher({ repairStrategies: 'all' }),
  ],

  // Exporters (每个自动被 EnrichingExporter 包裹, 再被 BatchSpanProcessor 包裹)
  exporters: [
    new LangfuseExporter({ publicKey: '...', secretKey: '...' }),
    // 标准 OTLP 也可以
    // new OTLPTraceExporter({ url: 'http://tempo:4318/v1/traces' }),
  ],

  // 开发模式: 额外输出到 console (SimpleSpanProcessor, 不经过 enrichers)
  dev: process.env.NODE_ENV !== 'production',

  // Content capture (opt-in, 敏感数据)
  // 统一配置, 传播到所有 instrumentations
  captureContent: {
    input: false,
    output: false,
    toolArguments: true,
    toolResults: true,
  },
});

// init() 内部执行:
// 1. 创建 NodeTracerProvider + AsyncLocalContextManager
// 2. 对每个 exporter: new EnrichingExporter(exporter, enrichers) → new BatchSpanProcessor(enriching)
// 3. 注册所有 instrumentations, 传入统一 captureContent config
// 4. 如果 dev: 额外 addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))

// 关闭时 flush
process.on('SIGTERM', () => ho.shutdown());
```

---

## MVP Phase 1 (修订)

目标: 一个可运行的最小 demo, 追踪 OpenAI agent 的 tool calling (含 streaming), 输出到 console + Langfuse。

1. `@ho/sdk` — init, @trace, withSpan, withAgentLoop, wrapLLMCall, EnrichingExporter, ReadableSpanWrapper, types
2. `@ho/tool-normalize` — OpenAI + Anthropic adapter, repair chain
3. `@ho/instrumentation-openai` — auto-patch openai SDK (同步 + streaming)
4. `@ho/exporter-langfuse` — OTLP/HTTP -> Langfuse
5. `@ho/enricher-cost` — token -> USD enricher

**不在 Phase 1**:
- Ingest server (eval/sandbox 接入)
- Anthropic/Gemini auto-instrumentation
- Error classify enricher
- File exporter / JSONL replay
- Agent loop 的 max_iterations / timeout / abort

---

## 依赖总览

```
@ho/sdk
  ├── @opentelemetry/api ^1.9
  ├── @opentelemetry/sdk-trace-node ^2.7
  ├── @opentelemetry/core ^2.7
  └── @opentelemetry/resources ^2.7

@ho/instrumentation-openai
  ├── @opentelemetry/api ^1.9
  └── @opentelemetry/instrumentation ^0.216

@ho/tool-normalize
  └── (zero deps, standalone)

@ho/exporter-langfuse
  ├── @opentelemetry/api ^1.9
  └── @opentelemetry/sdk-trace-base ^2.7

@ho/enricher-cost
  ├── @opentelemetry/api ^1.9
  └── @opentelemetry/sdk-trace-base ^2.7
```

---

## 工程约束与选型

### 基础设施选型

| 维度 | 选择 | 原因 |
|------|------|------|
| 包管理器 | **pnpm** | workspace protocol 原生支持; strict node_modules 防幽灵依赖; turbo+pnpm 是 2026 monorepo 标准组合 |
| 构建工具 | **tsup** | 基于 esbuild, 单配置输出 CJS+ESM+.d.ts; 库发布场景最优; 配置量极小 |
| 模块格式 | **Dual CJS+ESM** | auto-instrumentation 必须同时支持 `require-in-the-middle`(CJS) 和 `import-in-the-middle`(ESM); 用户应用可能是任一格式 |
| Node.js 最低版本 | **>=20** | AsyncLocalStorage 稳定; 原生 fetch; 足够的 ESM loader hooks 支持; Node 22 推荐但不强制 |
| 测试框架 | **vitest** | 原生 ESM; TypeScript 零配置; vi.mock() 适合 SDK 打桩; workspace 模式天然支持 monorepo |
| Lint + Format | **Biome** | 单工具替代 eslint+prettier; Rust 实现极快; TypeScript first-class; 新项目无历史包袱 |
| TypeScript | **5.5+**, strict mode, `"module": "nodenext"` | 最新类型推导; nodenext 强制正确的 ESM import 路径 |

### 包发布策略

| 维度 | 选择 | 原因 |
|------|------|------|
| Scope | `@ho/` (验证 npm 可用性后备选 `@genai-obs/`) | 短, 好记, 跟项目名一致 |
| 版本策略 | **统一版本** (所有 `@ho/*` 同步发布同一版本号) | 简化用户依赖管理; OTEL SDK 也是此模式; changesets 支持固定模式 |
| 例外 | `@ho/tool-normalize` 可独立版本 (如果未来社区采用广泛) | 零依赖, 用途超出 observability |
| Changelog | **changesets** | 自动生成, 支持 monorepo, 与 pnpm workspace 集成好 |

### 运行时硬约束

#### Enricher 契约

```typescript
interface SpanEnricher {
  // 必须同步 — OTEL export() 是 callback-based, 不支持 async
  enrich(span: ReadableSpan, attrs: Attributes): Attributes;
}
```

- **同步**: enricher 不可做 I/O、不可 await。需要外部数据 (如定价表) 必须在构造时预加载。
- **异常隔离**: 单个 enricher throw → catch + 跳过该 enricher + 发 diag warning → 后续 enrichers 和 export 正常继续。
- **无状态推荐**: enricher 内部不应持有可变状态。如果必须 (如统计计数器), 自行处理并发安全。

#### Auto-Instrumentation 容错

| 场景 | 行为 |
|------|------|
| 目标包未安装 (`openai` not found) | 静默跳过, diag.debug 日志 |
| 版本不在支持范围 | 静默跳过, diag.warn("openai@3.x not supported, need >=4") |
| Patch 过程中异常 | catch + diag.error + 不 patch (用户代码正常运行, 只是没有 auto span) |
| 用户 app 崩溃 | 绝不因 instrumentation 导致 — 所有 patch 代码 try-catch 包裹 |

**原则**: Observability 永远不能影响用户应用的正确性和稳定性。

#### Content 截断规则

| 目标 | 上限 | 策略 |
|------|------|------|
| 单个 attribute string value | 32 KB | 保留前 32KB + `\n...[truncated, total=X bytes]` |
| Tool arguments / results | 64 KB | 同上 (工具数据是核心价值, 给更大空间) |
| input/output messages (opt-in) | 128 KB | 同上 |
| 单次 export payload | 3 MB soft limit | 超过时 split batch (低于 Langfuse 3.5MB 硬限) |

#### Attribute 命名空间

| Prefix | 用途 | 示例 |
|--------|------|------|
| `gen_ai.*` | OTEL GenAI Semconv 标准属性 | `gen_ai.usage.input_tokens` |
| `ho.*` | 本框架自定义属性 | `ho.cost.usd`, `ho.error.category`, `ho.tool.repaired` |
| 用户自定义 | 用户通过 span.setAttribute 设置 | 任意 (建议 `app.*`) |

`ho.*` 与 `gen_ai.*` 不冲突; 用户不应使用 `ho.*` 前缀。

### Exporter 容错与 BatchSpanProcessor 配置

```typescript
// GenAI 场景优化: 低 QPS, 单 span 可能较大 (含 content)
const BATCH_CONFIG = {
  maxQueueSize: 2048,         // 队列最大 span 数 (默认即可)
  maxExportBatchSize: 64,     // 每批导出 (比默认 512 小, 因为 GenAI span 大)
  scheduledDelayMs: 5000,     // 5s 定时 flush
  exportTimeoutMs: 30000,     // 30s 超时 (网络可能慢)
};
```

| 维度 | 策略 |
|------|------|
| Export 失败 | 重试 3 次, 指数退避 (1s → 2s → 4s), 之后丢弃 |
| 队列满 | 丢弃最旧 span, diag.warn |
| `ho.shutdown()` | flush 等待 10s, 超时后 drop remaining + resolve |
| Disk fallback | **v1 不做** (后续可选 exporter-file 作为备份链路) |

### 定价表 (CostEnricher)

```typescript
interface ModelPricing {
  inputPerToken: number;              // USD per token
  outputPerToken: number;             // USD per token
  cacheReadPerToken?: number;         // 默认 inputPerToken * 0.1
  cacheCreationPerToken?: number;     // 默认 inputPerToken * 1.25
}

// 内建默认表 (打包在 @ho/enricher-cost 中)
const defaultPricing: Record<string, ModelPricing> = {
  'gpt-4o': { inputPerToken: 2.5e-6, outputPerToken: 10e-6 },
  'gpt-4o-mini': { inputPerToken: 0.15e-6, outputPerToken: 0.6e-6 },
  'gpt-4.1': { inputPerToken: 2e-6, outputPerToken: 8e-6 },
  'o3': { inputPerToken: 2e-6, outputPerToken: 8e-6 },
  'o3-mini': { inputPerToken: 1.1e-6, outputPerToken: 4.4e-6 },
  'claude-sonnet-4-5-20250514': { inputPerToken: 3e-6, outputPerToken: 15e-6 },
  'claude-opus-4-5-20250414': { inputPerToken: 15e-6, outputPerToken: 75e-6 },
  'claude-haiku-3-5-20241022': { inputPerToken: 0.8e-6, outputPerToken: 4e-6 },
  'gemini-2.0-flash': { inputPerToken: 0.1e-6, outputPerToken: 0.4e-6 },
  'gemini-2.5-pro': { inputPerToken: 1.25e-6, outputPerToken: 10e-6 },
  // ... 更多模型
};
```

| 维度 | 策略 |
|------|------|
| 默认表来源 | 包内 bundled JSON, 随版本发布更新 |
| 用户扩展 | `new CostEnricher({ pricing: { ...defaultPricing, ...custom } })` |
| 模型名匹配 | 先精确匹配, 再 prefix 匹配 (`gpt-4o-2024-*` → `gpt-4o`), 无匹配则跳过 |
| 运行时刷新 | **v1 不支持** — 升级包版本获取新定价 |

### captureContent 传播机制

```typescript
// 全局配置 (init 时设置)
ho.init({
  captureContent: { input: false, output: false, toolArguments: true, toolResults: true },
  instrumentations: [
    new OpenAIInstrumentation({ captureContent: { input: true } }),  // 覆盖全局
    new AnthropicInstrumentation(),                                   // 继承全局
  ],
});
```

| 规则 | 说明 |
|------|------|
| 优先级 | per-instrumentation field > 全局 field > 默认 (全 false) |
| 合并粒度 | 字段级覆盖, 不是整体替换 |
| 不可变 | init 后 captureContent 不可修改 (v1 无运行时切换) |
| 传播方式 | init() 内部将 resolved config 传给每个 instrumentation 的 `setConfig()` |

---

## 设计决策日志

| 决策 | 选择 | 原因 |
|------|------|------|
| Pipeline 基础 | OTEL SDK, 不从头建 | JS 无 Collector; SDK 足够; 免费获得后端兼容 |
| Enrichment 层 | EnrichingExporter, 非 SpanProcessor | ReadableSpan 不可变, onEnd 无法改属性 |
| ReadableSpan 包装 | 委托 wrapper class, 非 spread | spread 丢失方法, 下游 exporter 会崩 |
| Suppress 粒度 | 仅 wrapLLMCall 设置 | withSpan/@trace 需要 auto child spans |
| Ingest 关联 | Remote SpanContext 构造 | 跨进程 trace 必须用 remote parent |
| Streaming | Wrap async iterator + 最终 chunk 取 usage | 实际 agent 80%+ 是 stream |
| Agent loop | withAgentLoop + 扁平兄弟结构 | 符合 OTEL GenAI semconv invoke_agent |
| 包结构 | processors/ → enrichers/ | 名实相符, 避免误导 |
| 包管理器 | pnpm | monorepo 标准; strict; turbo 集成 |
| 构建 | tsup (dual CJS+ESM) | auto-instrumentation 需双格式 |
| Node.js | >=20 | fetch 原生; AsyncLocalStorage 稳定 |
| 测试 | vitest | ESM 原生; mock 能力强; 快 |
| Lint | Biome | 单工具; Rust 快; 新项目无包袱 |
| 版本 | 统一版本 (changesets fixed mode) | 用户简单; 内部简单 |
| Enricher 契约 | 同步 + 异常隔离 | export callback 不支持 async; 不能炸管道 |
| 截断 | 32KB attr / 64KB tool / 3MB payload | 平衡可观测性与传输成本 |
| 命名空间 | `ho.*` | 短; 不冲突; 好记 |
| 容错 | 3 次重试 + 丢弃; patch 失败静默 | observability 不影响用户 app |
| 定价表 | bundled + 用户扩展 + prefix 匹配 | 开箱即用; 灵活 |
| captureContent | 字段级覆盖, init 后不可变 | v1 简单; 后续可扩展 |
