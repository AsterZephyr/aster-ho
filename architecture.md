# Architecture Design: Agent Harness Observability Framework (ho)

## Design Principles

1. **OTEL-native**: 内部数据模型完全对齐 OTEL GenAI Semantic Conventions (v1.41.0)
2. **Pipeline-first**: Receiver-Processor-Exporter 全管道可插拔 (OTEL Collector 风格)
3. **Tool Normalization**: harness 层统一 tool calling schema, 屏蔽 OpenAI/Anthropic/Gemini 协议差异
4. **Eval 兼容层 (非自建 runner)**: 不做评判, 只做各评估框架 (SWE-bench/METR/Inspect AI) 的数据接入 Receiver, 暴露给用户以了解使用模式
5. **Sandbox 事件追踪 (非沙箱管理)**: 只接收外部沙箱 (Docker/E2B/Modal) 的执行事件, 不管理沙箱生命周期
6. **Zero-overhead when disabled**: NoOp 模式, 不影响 agent 执行性能
7. **Configuration-driven**: YAML 配置管道拓扑, 无需改代码切换后端

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent Harness (用户代码)                       │
│                                                                     │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌───────────────────┐    │
│  │ Agent   │  │ LLM     │  │ Tool     │  │ Eval Runner       │    │
│  │ Loop    │  │ Calls   │  │ Calls    │  │ (samples/scoring) │    │
│  └────┬────┘  └────┬────┘  └────┬─────┘  └────────┬──────────┘    │
│       │             │            │                  │               │
│       └─────────────┴────────────┴──────────────────┘               │
│                              │                                       │
│                    ┌─────────▼──────────┐                           │
│                    │   Instrumentation   │                           │
│                    │   Layer (SDK)       │                           │
│                    └─────────┬──────────┘                           │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │    ho Pipeline       │
                    │                      │
                    │  ┌───────────────┐   │
                    │  │  Receivers    │   │
                    │  │  (OTLP/SDK/   │   │
                    │  │   webhook)    │   │
                    │  └───────┬───────┘   │
                    │          │           │
                    │  ┌───────▼───────┐   │
                    │  │  Processors   │   │
                    │  │  (batch/      │   │
                    │  │   filter/     │   │
                    │  │   enrich/     │   │
                    │  │   normalize/  │   │
                    │  │   cost/       │   │
                    │  │   alert)      │   │
                    │  └───────┬───────┘   │
                    │          │           │
                    │  ┌───────▼───────┐   │
                    │  │  Exporters    │   │
                    │  │  (Langfuse/   │   │
                    │  │   Phoenix/    │   │
                    │  │   OTLP/       │   │
                    │  │   Console/    │   │
                    │  │   File/       │   │
                    │  │   Webhook)    │   │
                    │  └──────────────┘   │
                    └─────────────────────┘
```

---

## Core Data Model

基于 OTEL GenAI Semconv, 扩展 harness 专用字段。

### Span Kinds (领域语义)

```typescript
enum HarnessSpanKind {
  // OTEL GenAI standard
  AGENT_INVOKE = 'invoke_agent',
  LLM_CHAT = 'chat',
  TOOL_CALL = 'tools/call',
  TOOL_EXECUTE = 'execute_tool',
  RETRIEVAL = 'retrieval',

  // Harness-specific extensions
  EVAL_RUN = 'eval/run',           // 一次完整评估运行
  EVAL_SAMPLE = 'eval/sample',     // 单个评估样本
  EVAL_SCORE = 'eval/score',       // 评分操作
  AGENT_TURN = 'agent/turn',       // agent loop 单轮
  AGENT_HANDOFF = 'agent/handoff', // agent 切换
  GUARDRAIL = 'agent/guardrail',   // 护栏检查
  SANDBOX_EXEC = 'sandbox/exec',   // 沙箱命令执行
  RESOURCE_CHECK = 'resource/check', // 资源限制检查
}
```

### Attribute Namespaces

```typescript
// OTEL GenAI standard attributes
interface GenAIAttributes {
  'gen_ai.operation.name': string;
  'gen_ai.provider.name': string;       // openai | anthropic | google
  'gen_ai.request.model': string;
  'gen_ai.agent.name': string;
  'gen_ai.agent.id': string;
  'gen_ai.conversation.id': string;
  'gen_ai.usage.input_tokens': number;
  'gen_ai.usage.output_tokens': number;
  'gen_ai.usage.cache_read.input_tokens'?: number;
  'gen_ai.usage.cache_creation.input_tokens'?: number;
  'gen_ai.response.finish_reasons': string[];
  'gen_ai.response.id': string;
  'gen_ai.tool.call.id': string;
  'gen_ai.tool.call.arguments'?: string;  // opt-in (sensitive)
  'gen_ai.tool.call.result'?: string;     // opt-in (sensitive)
}

// Harness extension attributes
interface HarnessAttributes {
  // Eval context
  'harness.eval.run_id': string;
  'harness.eval.dataset': string;
  'harness.eval.sample_id': string;
  'harness.eval.score': number;
  'harness.eval.score_type': string;      // binary | float | categorical
  'harness.eval.grader': string;          // human | model | code

  // Resource limits
  'harness.resource.token_budget': number;
  'harness.resource.token_used': number;
  'harness.resource.time_limit_ms': number;
  'harness.resource.time_used_ms': number;
  'harness.resource.cost_limit_usd': number;
  'harness.resource.cost_used_usd': number;
  'harness.resource.message_limit': number;
  'harness.resource.message_count': number;

  // Tool normalization
  'harness.tool.normalized_name': string;      // 跨模型统一工具名
  'harness.tool.provider_format': string;      // openai | anthropic | gemini
  'harness.tool.schema_version': string;
  'harness.tool.validation_result': string;    // pass | fail | coerced
  'harness.tool.raw_arguments'?: string;       // 模型原始输出 (调试用)

  // Error classification (Cursor style)
  'harness.error.category': string;            // invalid_arguments | unexpected_environment | provider_error | timeout | user_aborted
  'harness.error.tool_name'?: string;
  'harness.error.model'?: string;
  'harness.error.recoverable': boolean;

  // Model switching context
  'harness.model.switched_from'?: string;
  'harness.model.switch_reason'?: string;
  'harness.model.context_strategy'?: string;   // continue | summarize | fresh
}
```

---

## Tool Calling Normalization Layer

这是整个框架最核心的差异化价值。

### Unified Tool Schema (内部标准)

```typescript
interface UnifiedToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema7;           // JSON Schema 7, 三家公约数
  strict?: boolean;                  // OpenAI strict mode
  required_parameters?: string[];
}

interface UnifiedToolCall {
  id: string;                        // 统一生成的 call ID
  name: string;
  arguments: Record<string, unknown>; // 已解析的 object (不是 string!)
  raw?: string;                      // 原始模型输出 (调试/回放)
}

interface UnifiedToolResult {
  call_id: string;
  content: string | object;
  is_error: boolean;
  error_type?: string;
}
```

### Provider Adapters

```typescript
interface ToolSchemaAdapter {
  provider: 'openai' | 'anthropic' | 'gemini';

  // Schema 转换: 内部标准 -> provider 格式
  encodeDefinitions(tools: UnifiedToolDefinition[]): unknown;

  // 调用解析: provider 响应 -> 统一格式
  decodeToolCalls(response: unknown): UnifiedToolCall[];

  // 结果编码: 统一格式 -> provider 消息格式
  encodeToolResults(results: UnifiedToolResult[]): unknown;

  // 修复: 处理模型的常见怪癖
  repair(raw: string): Record<string, unknown> | null;
}
```

### Repair Strategies (处理模型怪癖)

```typescript
interface RepairStrategy {
  // OpenAI: arguments 是 JSON string 而非 object
  doubleSerializedJson(raw: string): object | null;

  // Anthropic: 偶尔输出 markdown 包裹的 JSON (```json ... ```)
  markdownWrappedJson(raw: string): object | null;

  // Gemini: 有时省略 required fields, 需要填充默认值
  missingRequiredFields(parsed: object, schema: JSONSchema7): object;

  // 通用: trailing comma, single quotes, unquoted keys
  relaxedJsonParse(raw: string): object | null;
}
```

---

## Pipeline Architecture (Receiver-Processor-Exporter)

### Component Interfaces

```typescript
// 所有组件的生命周期
interface Component {
  readonly type: string;
  readonly name: string;
  start(): Promise<void>;
  shutdown(timeoutMs?: number): Promise<void>;
}

// Receiver: 数据入口
interface Receiver extends Component {
  // Receiver 通过 consumer 将数据推入管道
  setConsumer(consumer: SpanConsumer): void;
}

// Processor: 数据变换
interface Processor extends Component {
  // 处理单个 span (可变换、过滤、拆分、聚合)
  processSpan(span: HarnessSpan): HarnessSpan | HarnessSpan[] | null;

  // 处理 trace 级别事件
  onTraceStart?(trace: HarnessTrace): void;
  onTraceEnd?(trace: HarnessTrace): void;
}

// Exporter: 数据出口
interface Exporter extends Component {
  export(items: Array<HarnessTrace | HarnessSpan>): Promise<ExportResult>;
}

// Consumer: 管道内数据流转接口
interface SpanConsumer {
  consumeSpan(span: HarnessSpan): void;
  consumeTrace(trace: HarnessTrace): void;
}

type ExportResult = { code: 'success' } | { code: 'failure'; error: Error };
```

### Built-in Components

#### Receivers
| Name | 功能 |
|------|------|
| `otlp` | 接收标准 OTLP/gRPC 和 OTLP/HTTP 数据 |
| `sdk` | 内嵌 SDK 直接推送 (进程内, 零网络开销) |
| `webhook` | HTTP webhook 接收外部事件 (CI/CD, GitHub Actions) |
| `file` | 监听 JSONL 文件 (用于重放历史数据) |
| `claude-code` | 解析 Claude Code JSONL transcript |
| `swe-bench` | 接入 SWE-bench 评估日志 (report.json + instance.log) |
| `inspect-ai` | 接入 Inspect AI 评估事件流 (EvalLog + Transcript) |
| `metr` | 接入 METR Task Standard 评分结果 (ScoreLog) |
| `sandbox-docker` | 接收 Docker 容器事件 (exec/lifecycle/stats) |
| `sandbox-e2b` | 接收 E2B 沙箱执行事件 (CommandResult + Metrics) |
| `sandbox-modal` | 接收 Modal Sandbox 事件 (ContainerProcess) |

#### Processors
| Name | 功能 |
|------|------|
| `batch` | 批量聚合 (size/time window 可配) |
| `filter` | 按条件过滤 span (drop/keep) |
| `attributes` | 添加/修改/删除 attributes |
| `tool-normalize` | Tool calling schema normalization |
| `cost-calculate` | 根据 token usage + 模型定价计算成本 |
| `error-classify` | Cursor 风格的错误分类 |
| `resource-limit` | 检查/标记资源限制超出 |
| `pii-redact` | 脱敏处理 (tool arguments, prompts) |
| `alert` | 异常检测 + 告警 (基线偏移) |
| `sample` | 采样 (head/tail/probability) |
| `memory-limiter` | 反压, 防止 OOM |

#### Exporters
| Name | 功能 |
|------|------|
| `otlp` | 标准 OTLP/gRPC 和 OTLP/HTTP 输出 |
| `langfuse` | Langfuse API (generation + trace) |
| `phoenix` | Arize Phoenix (OTLP + OpenInference 转换) |
| `console` | 开发时 stdout 美化输出 |
| `file` | JSONL 文件 (持久化/回放) |
| `webhook` | HTTP POST 到任意端点 |
| `prometheus` | Metrics 聚合 -> Prometheus scrape endpoint |
| `noop` | 空实现 (基准测试用) |

### Pipeline Configuration (YAML)

```yaml
# ho.config.yaml
receivers:
  sdk:
    # 进程内 SDK 直推, 无配置
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"

processors:
  batch:
    send_batch_size: 128
    timeout: 5s
  tool-normalize:
    repair_strategies: [double_serialized, markdown_wrapped, relaxed_json]
    validation: strict    # strict | lenient | off
  cost-calculate:
    pricing:
      claude-opus-4-6:
        input: 15.0       # per 1M tokens
        output: 75.0
        cache_read: 1.5
        cache_write: 18.75
      gpt-4o:
        input: 2.5
        output: 10.0
  error-classify:
    categories:
      - name: invalid_arguments
        match: ["json parse", "schema validation", "missing required"]
      - name: provider_error
        match: ["rate limit", "overloaded", "503", "529"]
      - name: timeout
        match: ["timeout", "deadline exceeded"]
  pii-redact:
    fields: ["gen_ai.tool.call.arguments", "gen_ai.tool.call.result"]
    strategy: hash    # hash | mask | drop
  alert:
    rules:
      - name: high_error_rate
        condition: "error_rate > 0.1"
        window: 5m
        notify: webhook

exporters:
  langfuse:
    public_key: ${LANGFUSE_PUBLIC_KEY}
    secret_key: ${LANGFUSE_SECRET_KEY}
    endpoint: "https://cloud.langfuse.com"
    batch_size: 50
  otlp:
    endpoint: "tempo:4317"
    protocol: grpc
  console:
    verbosity: minimal    # minimal | detailed | full
  file:
    path: "./traces"
    format: jsonl
    rotation: daily

# Pipeline 拓扑: 哪些 receiver -> processor -> exporter
service:
  pipelines:
    traces:
      receivers: [sdk, otlp]
      processors: [memory-limiter, tool-normalize, cost-calculate, error-classify, batch]
      exporters: [langfuse, otlp, file]
    metrics:
      receivers: [sdk]
      processors: [batch]
      exporters: [prometheus]
    dev:
      receivers: [sdk]
      processors: [tool-normalize]
      exporters: [console]
```

---

## Instrumentation SDK (用户侧 API)

```typescript
import { ho } from '@ho/sdk';

// 初始化 (读取 ho.config.yaml)
ho.init({ configPath: './ho.config.yaml' });

// ---- Agent Loop 追踪 ----
const trace = ho.startTrace('code-review-agent', {
  groupId: conversationId,        // 关联对话
  metadata: { user: 'frank' },
});

// Agent 调用
const agentSpan = trace.startSpan(HarnessSpanKind.AGENT_INVOKE, {
  'gen_ai.agent.name': 'code-reviewer',
  'harness.resource.token_budget': 100000,
});

// LLM 调用
const llmSpan = agentSpan.startSpan(HarnessSpanKind.LLM_CHAT, {
  'gen_ai.request.model': 'claude-opus-4-6',
  'gen_ai.provider.name': 'anthropic',
});
// ... LLM 调用完成
llmSpan.end({
  'gen_ai.usage.input_tokens': 1500,
  'gen_ai.usage.output_tokens': 800,
  'gen_ai.response.finish_reasons': ['tool_use'],
});

// Tool 调用 (经过 normalization)
const toolSpan = agentSpan.startSpan(HarnessSpanKind.TOOL_CALL, {
  'gen_ai.tool.call.id': 'call_abc123',
  'harness.tool.normalized_name': 'read_file',
  'harness.tool.provider_format': 'anthropic',
});
toolSpan.end({
  'harness.tool.validation_result': 'pass',
});

agentSpan.end();
trace.end();

// ---- Eval Run 追踪 ----
const evalTrace = ho.startEvalRun({
  dataset: 'swe-bench-lite',
  runId: 'run-2026-05-05',
  model: 'claude-opus-4-6',
  harnessVersion: '0.1.0',
});

for (const sample of dataset) {
  const sampleSpan = evalTrace.startSample(sample.id);
  // ... agent 执行 ...
  sampleSpan.score({ value: 0.85, type: 'float', grader: 'code' });
  sampleSpan.end();
}

evalTrace.end();

// ---- 装饰器模式 (简化版) ----
class MyAgent {
  @ho.trace(HarnessSpanKind.AGENT_INVOKE)
  async run(input: string) {
    const result = await this.callLLM(input);
    return result;
  }

  @ho.trace(HarnessSpanKind.LLM_CHAT, { captureIO: true })
  async callLLM(prompt: string) {
    return await anthropic.messages.create({ ... });
  }

  @ho.trace(HarnessSpanKind.TOOL_CALL)
  async executeTool(call: UnifiedToolCall) {
    return await this.tools[call.name](call.arguments);
  }
}
```

---

## Package Structure

```
ho/
├── packages/
│   ├── core/                      # 核心数据模型 + pipeline 引擎
│   │   ├── src/
│   │   │   ├── model/             # HarnessSpan, HarnessTrace, Attributes
│   │   │   ├── pipeline/          # Pipeline, PipelineBuilder
│   │   │   ├── context/           # AsyncLocalStorage-based context propagation
│   │   │   ├── config/            # YAML config loader + validation
│   │   │   └── noop/             # NoOp implementations
│   │   └── package.json
│   │
│   ├── sdk/                       # Instrumentation SDK (用户直接用)
│   │   ├── src/
│   │   │   ├── tracer.ts          # ho.startTrace(), ho.startSpan()
│   │   │   ├── decorators.ts      # @ho.trace()
│   │   │   ├── eval.ts            # ho.startEvalRun()
│   │   │   └── init.ts            # ho.init()
│   │   └── package.json
│   │
│   ├── tool-normalize/            # Tool calling normalization (独立可用)
│   │   ├── src/
│   │   │   ├── schema.ts          # UnifiedToolDefinition, UnifiedToolCall
│   │   │   ├── adapters/
│   │   │   │   ├── openai.ts
│   │   │   │   ├── anthropic.ts
│   │   │   │   └── gemini.ts
│   │   │   ├── repair.ts          # Repair strategies
│   │   │   └── validate.ts        # Schema validation
│   │   └── package.json
│   │
│   ├── receivers/
│   │   ├── receiver-otlp/
│   │   ├── receiver-sdk/          # (内嵌在 core)
│   │   ├── receiver-webhook/
│   │   ├── receiver-file/
│   │   ├── receiver-claude-code/
│   │   ├── receiver-swe-bench/    # SWE-bench 兼容层
│   │   ├── receiver-inspect-ai/   # Inspect AI 兼容层
│   │   ├── receiver-metr/         # METR Task Standard 兼容层
│   │   ├── receiver-sandbox-docker/
│   │   ├── receiver-sandbox-e2b/
│   │   └── receiver-sandbox-modal/
│   │
│   ├── processors/
│   │   ├── processor-batch/
│   │   ├── processor-filter/
│   │   ├── processor-cost/
│   │   ├── processor-error-classify/
│   │   ├── processor-pii-redact/
│   │   ├── processor-alert/
│   │   ├── processor-resource-limit/
│   │   └── processor-sample/
│   │
│   ├── exporters/
│   │   ├── exporter-otlp/
│   │   ├── exporter-langfuse/
│   │   ├── exporter-phoenix/
│   │   ├── exporter-console/
│   │   ├── exporter-file/
│   │   ├── exporter-webhook/
│   │   └── exporter-prometheus/
│   │
│   └── cli/                       # ho CLI (启动 pipeline, 健康检查, 回放)
│       ├── src/
│       │   ├── serve.ts           # 以独立进程运行 pipeline
│       │   ├── replay.ts          # 回放 JSONL 文件
│       │   └── validate.ts        # 验证配置文件
│       └── package.json
│
├── ho.config.yaml                 # 默认配置
├── tsconfig.json
├── turbo.json                     # Turborepo monorepo 管理
└── package.json
```

---

## Key Design Decisions

### 1. AsyncLocalStorage for Context Propagation

类比 OpenAI Agents SDK 的 `contextvars`, 用 Node.js 的 `AsyncLocalStorage`:
- 自动 parent-child span 嵌套
- 无需显式传递 context
- 对 async/await 友好

### 2. Plugin Discovery

类比 OTEL Collector 的 factory 注册:
```typescript
// 每个 plugin package 导出 factory
export const factory: ReceiverFactory = {
  type: 'otlp',
  createDefaultConfig: () => ({ protocols: { grpc: { endpoint: '0.0.0.0:4317' } } }),
  createReceiver: (config, consumer) => new OTLPReceiver(config, consumer),
};
```

Config loader 通过 package name 动态 import plugin:
- `@ho/receiver-otlp` -> receivers.otlp
- `@ho/exporter-langfuse` -> exporters.langfuse

### 3. Backpressure (反压)

Memory limiter processor 在队列满时:
1. 先 drop 低优先级 span (如 debug-level tool IO)
2. 再通知 receiver 暂停接收
3. 最后 force flush exporter

### 4. Multi-pipeline

一份数据可以走多条管道 (类 OTEL Collector service.pipelines):
- traces pipeline: 完整追踪 -> Langfuse + OTLP
- metrics pipeline: 聚合指标 -> Prometheus
- dev pipeline: 实时输出 -> Console

### 5. Connector (pipeline 间桥接)

从 traces 生成 metrics (如 "span 持续时间 -> histogram"):
```yaml
connectors:
  span-metrics:
    dimensions: [gen_ai.request.model, harness.tool.normalized_name]
    metrics:
      - name: llm_call_duration
        type: histogram
        source: span_duration
        filter: { kind: chat }
      - name: tool_error_count
        type: counter
        filter: { 'harness.error.category': '*' }
```

---

## Relationship to Cursor's Insights

| Cursor 经验 | ho 框架对应 |
|-------------|------------|
| "工具错误是最大 bug 表面" | `processor-error-classify` + `processor-alert` 按工具/模型基线检测 |
| "工具格式贴合训练分布" | `tool-normalize` adapter per provider, 含 repair strategies |
| "代码留存率 + LLM 判读满意度" | Exporter 可对接自定义评估系统, eval span 携带 score |
| "用 agent 维护 agent" | `receiver-webhook` 接收 CI/CD 事件, alert processor 触发自动修复流 |
| "中途换模型 = OOD + cache miss" | `harness.model.switched_from` attribute + context_strategy 追踪 |
| "Multi-Agent 是 harness 问题" | AGENT_HANDOFF span + parent-child 关系追踪委派链 |
| "减少喂养, 增加感官" | harness 追踪模型自主获取上下文的行为, 而非只追踪静态注入 |

---

## MVP Scope (Phase 1)

Phase 1 目标: 能跑通一个最小管道, 追踪单个 agent 的 tool calling + LLM 调用。

1. `core`: 数据模型 + pipeline engine + config loader
2. `sdk`: ho.init() + ho.startTrace() + ho.startSpan() + @ho.trace()
3. `tool-normalize`: OpenAI + Anthropic adapter + repair
4. `receiver-sdk`: 进程内直推
5. `processor-batch`: 批量
6. `processor-tool-normalize`: 管道内 normalization
7. `exporter-console`: 开发输出
8. `exporter-file`: JSONL 持久化

Phase 2: Langfuse/Phoenix exporter, cost processor, error-classify, OTLP receiver
Phase 3: Alert, Prometheus metrics, CLI, eval 兼容层 receivers (SWE-bench/Inspect AI/METR), sandbox receivers, connector

---

## Langfuse Exporter 实现规格

### 协议细节 (基于调研)

直接发送 OTLP/HTTP 到 Langfuse, 无需依赖 Langfuse SDK:

```
POST {endpoint}/api/public/otel/v1/traces
Authorization: Basic base64(public_key:secret_key)
Content-Type: application/json
Content-Encoding: gzip (optional)
```

### 属性映射策略

我们使用标准 `gen_ai.*` 属性, Langfuse 服务端会自动映射:

| ho 内部属性 (OTEL GenAI) | Langfuse 自动映射 |
|---|---|
| `gen_ai.operation.name` = chat/completion | type = GENERATION |
| `gen_ai.operation.name` = invoke_agent | type = AGENT |
| `gen_ai.operation.name` = execute_tool | type = TOOL |
| `gen_ai.response.model` | observation.model |
| `gen_ai.usage.input_tokens` | usageDetails.input |
| `gen_ai.usage.output_tokens` | usageDetails.output |
| `gen_ai.usage.cache_read.input_tokens` | usageDetails.input_cached_tokens |
| `gen_ai.input.messages` (opt-in) | observation.input |
| `gen_ai.output.messages` (opt-in) | observation.output |
| `gen_ai.tool.call.arguments` (opt-in) | observation.input (for TOOL) |
| `gen_ai.tool.call.result` (opt-in) | observation.output (for TOOL) |
| `gen_ai.conversation.id` | trace.sessionId (fallback) |

额外注入 Langfuse 专有属性以增强可视化:

| 补充属性 | 用途 |
|---|---|
| `user.id` | trace.userId |
| `session.id` | trace.sessionId |
| `langfuse.trace.name` | 覆盖 trace 显示名 |
| `langfuse.trace.tags` | trace 标签 (JSON array) |
| `langfuse.environment` | 环境标记 |

### 关键实现要点

1. **ID 直接映射**: OTEL trace_id (32 hex) = Langfuse trace ID, span_id (16 hex) = observation ID
2. **无需 scope 过滤**: 直接发 HTTP 到 OTEL endpoint 时, 服务端接受所有 span (绕过 SDK 客户端过滤)
3. **Batch 限制**: payload max 3.5 MB, 需内部 batch processor 配合
4. **Cost 自动计算**: 只需发 token usage + model name, Langfuse 服务端根据定价表自动算费用
5. **Retry**: 标准 OTLP exporter 指数退避 (5xx 重试, 4xx 不重试)

---

## Eval 兼容层 Receiver 设计

### 设计原则

不做评判逻辑, 只做数据接入:
- 解析各框架的输出格式 -> 转换为 OTEL GenAI span
- 暴露统一 API 给用户, 收集使用模式
- 支持实时接入 (webhook/stream) 和批量回放 (file)

### SWE-bench Receiver

输入: `logs/{run_id}/{model}/{instance_id}/report.json` + `instance.log`

转换为:
- 1 个 `eval/run` span (整个 run)
- N 个 `eval/sample` span (每个 instance)
- 每个 sample 带 attributes: resolved, FAIL_TO_PASS 结果, PASS_TO_PASS 结果, timed_out, runtime

### Inspect AI Receiver

输入: EvalLog JSON (含 Transcript events)

转换为:
- EvalLog -> `eval/run` span
- 每个 Sample -> `eval/sample` span
- Sample 内的 ModelEvent -> `chat` span
- Sample 内的 ToolEvent -> `execute_tool` span
- Sample 内的 SandboxEvent -> `sandbox/exec` span
- ScoreEvent -> `gen_ai.evaluation.result` event

### METR Receiver

输入: ScoreLog + ExecResult

转换为:
- TaskFamily 执行 -> `eval/run` span
- 每次 scoring -> `eval/score` span with `gen_ai.evaluation.score.value`
- IntermediateScoreInfo -> span events with timestamps

---

## Sandbox Receiver 设计

### 统一事件模型 -> OTEL Span 映射

```typescript
// Sandbox 事件转换为 OTEL span
function sandboxEventToSpan(event: SandboxExecutionEvent): HarnessSpan {
  return {
    name: `sandbox/${event.action} ${event.command?.split(' ')[0] ?? ''}`.trim(),
    kind: SpanKind.INTERNAL,
    attributes: {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': `sandbox.${event.action}`,
      'gen_ai.tool.call.arguments': JSON.stringify({
        command: event.command,
        cwd: event.cwd,
        timeout: event.timeout_limit_s,
      }),
      'gen_ai.tool.call.result': JSON.stringify({
        exit_code: event.exit_code,
        stdout: event.stdout,  // truncated
        timed_out: event.timed_out,
      }),
      // harness 扩展
      'harness.sandbox.type': event.sandbox_type,
      'harness.sandbox.id': event.sandbox_id,
      'harness.sandbox.template': event.sandbox_template,
      'harness.sandbox.exit_code': event.exit_code,
      'harness.sandbox.timed_out': event.timed_out,
      'harness.sandbox.duration_ms': event.duration_ms,
      'harness.sandbox.lifecycle_state': event.lifecycle_state,
    },
    startTime: event.started_at,
    endTime: event.completed_at,
    parentSpanId: event.span_id,  // 关联到触发的 agent span
  };
}
```

### Docker Receiver 实现

```typescript
// 两种模式:
// 1. Passive: 监听 docker events stream
// 2. Active: 包装 docker exec 调用

interface DockerReceiverConfig {
  mode: 'passive' | 'active' | 'both';
  container_labels_filter?: Record<string, string>;  // 只追踪特定 label 的容器
  capture_stats: boolean;           // 是否采集 CPU/memory
  stats_interval_ms: number;        // stats 采集间隔
  output_truncate_lines: number;    // stdout/stderr 截断行数 (default: 100)
  output_max_bytes: number;         // 硬限制 (default: 1MB)
}
```

### E2B Receiver 实现

```typescript
interface E2BReceiverConfig {
  wrap_commands: boolean;           // 是否自动包装 sandbox.commands.*
  capture_metrics: boolean;         // 是否轮询 SandboxMetrics
  metrics_poll_interval_ms: number; // 指标轮询间隔
}

// E2B SDK hook point:
// 包装 sandbox.commands.run() 和 sandbox.commands.start()
// 从 CommandResult 提取: stdout, stderr, exit_code, error
// 从 SandboxMetrics 提取: cpu_used_pct, mem_used, disk_used
```

