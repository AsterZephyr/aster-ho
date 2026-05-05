# Deep Dive Research: OTEL GenAI Semconv + Langfuse OTEL Bridge + Sandbox Tracing

## Part 1: OTEL GenAI Semantic Conventions (v1.41.0)

### Status
- **Version**: v1.41.0 (2026-04-28)
- **Stability**: Development (not stable yet)
- **Opt-in**: `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`
- **Repo**: github.com/open-telemetry/semantic-conventions `docs/gen-ai/`

### Spec File Structure
- `gen-ai-spans.md` — 核心推理、嵌入、检索、工具执行 span
- `gen-ai-agent-spans.md` — Agent 专用 span (create, invoke, workflow)
- `gen-ai-events.md` — 事件 (operation details, evaluation)
- `gen-ai-metrics.md` — 客户端和服务端指标
- `mcp.md` — Model Context Protocol 约定
- Provider-specific: `openai.md`, `anthropic.md`, `aws-bedrock.md`

---

### Complete Attribute Table

#### Core `gen_ai.*` Attributes

| Attribute | Type | Req Level | Description |
|-----------|------|-----------|-------------|
| `gen_ai.operation.name` | string | **Required** | 操作类型 |
| `gen_ai.provider.name` | string | **Required** | 提供商标识 |
| `gen_ai.request.model` | string | Cond. Required | 请求的模型名 |
| `gen_ai.response.model` | string | Recommended | 实际响应的模型名 |
| `gen_ai.request.max_tokens` | int | Recommended | 最大生成 token |
| `gen_ai.request.temperature` | double | Recommended | 温度参数 |
| `gen_ai.request.top_p` | double | Recommended | Top-p 采样 |
| `gen_ai.request.top_k` | double | Recommended | Top-k 采样 |
| `gen_ai.request.frequency_penalty` | double | Recommended | 频率惩罚 |
| `gen_ai.request.presence_penalty` | double | Recommended | 存在惩罚 |
| `gen_ai.request.stop_sequences` | string[] | Recommended | 停止序列 |
| `gen_ai.request.seed` | int | Cond. Required | 可复现种子 |
| `gen_ai.request.stream` | boolean | Cond. Required | 是否流式 |
| `gen_ai.request.choice.count` | int | Cond. Required | 候选数量 |
| `gen_ai.request.encoding_formats` | string[] | Recommended | 嵌入编码格式 |
| `gen_ai.response.id` | string | Recommended | 响应唯一 ID |
| `gen_ai.response.finish_reasons` | string[] | Recommended | 停止原因 |
| `gen_ai.response.time_to_first_chunk` | double | Recommended | 首 chunk 延迟(秒) |
| `gen_ai.output.type` | string | Cond. Required | 请求的输出类型 |
| `gen_ai.conversation.id` | string | Cond. Required | 会话/线程 ID |
| `gen_ai.usage.input_tokens` | int | Recommended | 输入 token 数 |
| `gen_ai.usage.output_tokens` | int | Recommended | 输出 token 数 |
| `gen_ai.usage.reasoning.output_tokens` | int | Recommended | 推理/CoT token 数 |
| `gen_ai.usage.cache_creation.input_tokens` | int | Recommended | 写入缓存的 token |
| `gen_ai.usage.cache_read.input_tokens` | int | Recommended | 从缓存读取的 token |
| `gen_ai.input.messages` | structured | **Opt-In** | 完整聊天历史输入 |
| `gen_ai.output.messages` | structured | **Opt-In** | 模型响应消息 |
| `gen_ai.system_instructions` | structured | **Opt-In** | System prompt |
| `gen_ai.tool.definitions` | structured | **Opt-In** | 可用工具定义 |
| `gen_ai.token.type` | string | — | token 类型 (指标用) |
| `gen_ai.data_source.id` | string | — | RAG 数据源 ID |
| `gen_ai.embeddings.dimension.count` | int | — | 嵌入维度 |
| `gen_ai.retrieval.documents` | structured | — | 检索到的文档 |
| `gen_ai.retrieval.query.text` | string | — | 检索查询文本 |

#### Agent-Specific Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.agent.id` | string | 唯一 agent 标识 |
| `gen_ai.agent.name` | string | 人类可读 agent 名 |
| `gen_ai.agent.description` | string | Agent 描述 |
| `gen_ai.agent.version` | string | Agent 版本 |
| `gen_ai.workflow.name` | string | 工作流/管道名称 |

#### Tool Execution Attributes

| Attribute | Type | Req Level | Description |
|-----------|------|-----------|-------------|
| `gen_ai.tool.name` | string | Required | 工具名称 |
| `gen_ai.tool.call.id` | string | Recommended | 工具调用 ID |
| `gen_ai.tool.description` | string | Recommended | 工具描述 |
| `gen_ai.tool.type` | string | Recommended | function/extension/datastore |
| `gen_ai.tool.call.arguments` | structured | **Opt-In** | 工具调用参数 |
| `gen_ai.tool.call.result` | structured | **Opt-In** | 工具调用结果 |

#### MCP-Specific Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `mcp.method.name` | string | MCP 方法 (tools/call, initialize 等) |
| `mcp.protocol.version` | string | MCP 协议版本 |
| `mcp.session.id` | string | MCP session ID |
| `mcp.resource.uri` | string | 资源 URI |
| `gen_ai.prompt.name` | string | Prompt 模板名 |
| `jsonrpc.request.id` | string | JSON-RPC 请求 ID |
| `jsonrpc.protocol.version` | string | JSON-RPC 版本 |

#### Evaluation Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.evaluation.name` | string | 评估指标名 |
| `gen_ai.evaluation.score.value` | double | 数值分数 |
| `gen_ai.evaluation.score.label` | string | 分数标签 |
| `gen_ai.evaluation.explanation` | string | 评估解释 |

---

### Span Types, Naming, and SpanKind

| Span Type | Name Format | SpanKind | operation.name |
|-----------|-------------|----------|----------------|
| Inference | `{operation.name} {model}` | CLIENT | chat, text_completion, generate_content |
| Embeddings | `{operation.name} {model}` | CLIENT | embeddings |
| Retrieval | `{operation.name} {data_source.id}` | CLIENT | retrieval |
| Execute Tool | `execute_tool {tool.name}` | INTERNAL | execute_tool |
| Create Agent | `create_agent {agent.name}` | CLIENT | create_agent |
| Invoke Agent (remote) | `invoke_agent {agent.name}` | CLIENT | invoke_agent |
| Invoke Agent (local) | `invoke_agent {agent.name}` | INTERNAL | invoke_agent |
| Invoke Workflow | `invoke_workflow {workflow.name}` | INTERNAL | invoke_workflow |
| MCP Client | `{mcp.method.name} {target}` | CLIENT | (varies) |
| MCP Server | `{mcp.method.name} {target}` | SERVER | (varies) |

### `gen_ai.operation.name` Well-Known Values

chat, text_completion, generate_content, embeddings, retrieval, execute_tool, create_agent, invoke_agent, invoke_workflow

### `gen_ai.provider.name` Well-Known Values

openai, anthropic, aws.bedrock, azure.ai.inference, azure.ai.openai, cohere, deepseek, gcp.gemini, gcp.gen_ai, gcp.vertex_ai, groq, ibm.watsonx.ai, mistral_ai, perplexity, x_ai

### Parent-Child 关系 (Agent Loop)

```
invoke_agent weather-forecast-agent (INTERNAL, s1)
  |-- chat claude-opus-4-6 (CLIENT, parent=s1)
  |-- tools/call get-weather (CLIENT, parent=s1)        # MCP client
  |     |-- tools/call get-weather (SERVER)             # MCP server
  |-- chat claude-opus-4-6 (CLIENT, parent=s1)          # 带 tool result
```

关键原则:
- `invoke_agent` span 是整个循环的根/父级
- 循环内每次 LLM 调用是子 CLIENT span
- Tool 执行根据位置是 INTERNAL 或 CLIENT
- MCP 工具调用创建 CLIENT -> SERVER span 对
- 同一 agent 调用内的多轮 LLM/tool 是同级兄弟

### MCP Context Propagation

通过 JSON-RPC `params._meta` 传播:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get-weather",
    "_meta": {
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "tracestate": "rojo=00f067aa0ba902b7"
    }
  }
}
```

### Streaming 处理

Spec 中仍为 TODO。当前指导:
- span 上设置 `gen_ai.request.stream = true`
- 记录 `gen_ai.response.time_to_first_chunk` (秒)
- span 覆盖整个流的持续时间
- content 记录为完整缓冲结果 (非逐 chunk)

---

### Events

#### `gen_ai.client.inference.operation.details`
- 用途: 捕获完整推理请求详情作为独立事件 (与 trace 独立)
- Body: 使用与 inference span 相同的 attributes

#### `gen_ai.evaluation.result`
- 用途: 捕获输出质量评估结果
- Required: `gen_ai.evaluation.name`
- Optional: `score.value`, `score.label`, `explanation`, `response.id`
- 父级: SHOULD 挂在被评估的 GenAI operation span 下

### Metrics

#### Client Metrics

| Metric | Instrument | Unit | Level |
|--------|-----------|------|-------|
| `gen_ai.client.operation.duration` | Histogram | s | **Required** |
| `gen_ai.client.token.usage` | Histogram | {token} | Recommended |
| `gen_ai.client.operation.time_to_first_chunk` | Histogram | s | Recommended |
| `gen_ai.client.operation.time_per_output_chunk` | Histogram | s | Recommended |

**Token usage buckets**: [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864]

**Duration buckets**: [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92]

#### Server Metrics

| Metric | Instrument | Unit |
|--------|-----------|------|
| `gen_ai.server.request.duration` | Histogram | s |
| `gen_ai.server.time_per_output_token` | Histogram | s |
| `gen_ai.server.time_to_first_token` | Histogram | s |

#### MCP Metrics

| Metric | Instrument | Unit |
|--------|-----------|------|
| `mcp.client.operation.duration` | Histogram | s |
| `mcp.server.operation.duration` | Histogram | s |
| `mcp.client.session.duration` | Histogram | s |
| `mcp.server.session.duration` | Histogram | s |

---

## Part 2: Langfuse OTEL Bridge (Complete Protocol)

### Endpoint

```
POST {base_url}/api/public/otel/v1/traces
Authorization: Basic base64(public_key:secret_key)
Content-Type: application/json  (or application/x-protobuf)
Content-Encoding: gzip (supported)
```

**Response**: `200 OK` with `{}` on success. 400/401/403 on error.

### Payload Format (JSON Protobuf)

```json
{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        {"key": "service.name", "value": {"stringValue": "my-agent"}}
      ]
    },
    "scopeSpans": [{
      "scope": {"name": "my-tracer", "version": "1.0.0"},
      "spans": [{
        "traceId": "32-hex-chars",
        "spanId": "16-hex-chars",
        "parentSpanId": "",
        "name": "span-name",
        "kind": 1,
        "startTimeUnixNano": "1747872000000000000",
        "endTimeUnixNano": "1747872001000000000",
        "attributes": [...],
        "status": {}
      }]
    }]
  }]
}
```

### ID Mapping
- OTEL `trace_id` (32 hex) -> Langfuse trace ID (直接映射)
- OTEL `span_id` (16 hex) -> Langfuse observation ID
- OTEL `parent_span_id` -> Langfuse `parentObservationId`
- Root span: 无 parentSpanId 或 `langfuse.internal.as_root = "true"`

### Observation Type 判定优先级

1. `langfuse.observation.type` 属性 (最高优先级)
2. OpenInference `openinference.span.kind` 属性
3. `gen_ai.operation.name` 标准属性
4. `gen_ai.tool.call.id` 存在 -> TOOL
5. 任何 model 属性存在 -> GENERATION (fallback)
6. 默认 -> SPAN

### 完整属性映射表

#### Langfuse 专有属性 (Priority 1)

| OTEL Attribute | Langfuse Field |
|---|---|
| `langfuse.observation.type` | observation type (span/generation/event/tool/agent/chain...) |
| `langfuse.observation.input` | observation.input (JSON string) |
| `langfuse.observation.output` | observation.output (JSON string) |
| `langfuse.observation.metadata.*` | observation.metadata (dot -> nested) |
| `langfuse.observation.level` | observation.level (DEFAULT/DEBUG/WARNING/ERROR) |
| `langfuse.observation.status_message` | observation.statusMessage |
| `langfuse.observation.model.name` | observation.model |
| `langfuse.observation.model.parameters` | observation.modelParameters (JSON) |
| `langfuse.observation.usage_details` | observation.usageDetails (JSON) |
| `langfuse.observation.cost_details` | observation.costDetails (JSON) |
| `langfuse.observation.completion_start_time` | observation.completionStartTime |
| `langfuse.observation.prompt.name` | observation.promptName |
| `langfuse.observation.prompt.version` | observation.promptVersion |
| `langfuse.trace.name` | trace.name |
| `langfuse.trace.input` | trace.input |
| `langfuse.trace.output` | trace.output |
| `langfuse.trace.tags` | trace.tags (JSON array or comma-separated) |
| `langfuse.trace.public` | trace.public |
| `langfuse.trace.metadata` / `langfuse.trace.metadata.*` | trace.metadata |
| `user.id` / `langfuse.user.id` | trace.userId |
| `session.id` / `langfuse.session.id` | trace.sessionId |
| `langfuse.environment` | environment |
| `langfuse.release` | release (fallback: `service.version`) |

#### OpenInference 映射 (Priority 2)

| openinference.span.kind | Langfuse type |
|---|---|
| LLM | GENERATION |
| CHAIN | CHAIN |
| RETRIEVER | RETRIEVER |
| EMBEDDING | EMBEDDING |
| AGENT | AGENT |
| TOOL | TOOL |
| GUARDRAIL | GUARDRAIL |
| EVALUATOR | EVALUATOR |

#### GenAI Semconv 映射 (Priority 3)

| gen_ai.operation.name | Langfuse type |
|---|---|
| chat / completion / text_completion / generate_content / generate | GENERATION |
| embeddings | EMBEDDING |
| invoke_agent / create_agent | AGENT |
| execute_tool | TOOL |

| OTEL Attribute | Langfuse Field |
|---|---|
| `gen_ai.response.model` (preferred) / `gen_ai.request.model` | observation.model |
| `gen_ai.request.temperature` | modelParameters.temperature |
| `gen_ai.request.max_tokens` | modelParameters.maxTokens |
| `gen_ai.response.finish_reasons` | modelParameters.finishReason |
| `gen_ai.usage.input_tokens` | usageDetails.input |
| `gen_ai.usage.output_tokens` | usageDetails.output |
| `gen_ai.usage.total_tokens` | usageDetails.total |
| `gen_ai.usage.cost` | costDetails.total |
| `gen_ai.usage.cache_read.input_tokens` | usageDetails.input_cached_tokens |
| `gen_ai.usage.cache_creation.input_tokens` | usageDetails.input_cache_creation |
| `gen_ai.conversation.id` | trace.sessionId (fallback) |
| `gen_ai.tool.name` | observation name (overrides span.name) |
| `gen_ai.tool.call.arguments` | observation.input |
| `gen_ai.tool.call.result` | observation.output |
| `gen_ai.input.messages` | observation.input |
| `gen_ai.output.messages` | observation.output |
| `gen_ai.system_instructions` | prepended to input as system message |
| `gen_ai.tool.definitions` | appended to input |

#### Model Name Resolution Order (fallback chain)

1. `langfuse.observation.model.name`
2. `gen_ai.response.model`
3. `ai.model.id`
4. `gen_ai.request.model`
5. `llm.response.model`
6. `llm.model_name`
7. `model`

### 关键实现细节

**直接发送 HTTP 请求时**:
- 绕过 SDK 的 `LangfuseSpanProcessor` 客户端过滤
- 服务端 `OtelIngestionProcessor` 接受所有 span (无 scope 过滤)
- 无需使用 Langfuse SDK

**Batch 限制**:
- Max payload: 3.5 MB
- Oversized span 警告: 16 MB per request

**Cost 计算**:
1. 如果提供 `langfuse.observation.cost_details` -> 直接使用
2. 如果只提供 token usage -> Langfuse 服务端根据模型定价表计算

---

## Part 3: Sandbox Event Tracing

### Provider Landscape

| Provider | 隔离方式 | 用于 | 事件获取方式 |
|----------|---------|------|-------------|
| Docker | 容器 | SWE-bench, Inspect AI, METR | docker exec API + events stream |
| E2B | Cloud microVM | AI agent frameworks | REST/WS API, CommandResult |
| Modal | Cloud container | Anthropic Computer Use | Sandbox.exec() -> ContainerProcess |
| Daytona | Docker 容器 | Dev environments | Docker event stream + OTel collector |
| Firecracker | MicroVM | AWS Lambda 底层 | JSON metrics flush every 60s |

### 统一事件 Schema 设计 (基于 Inspect AI SandboxEvent)

```typescript
interface SandboxExecutionEvent {
  // Identity & correlation
  event_id: string;       // uuid
  span_id: string;        // 触发此操作的 agent span
  trace_id: string;       // 整体 trace

  // Sandbox identity
  sandbox_type: 'docker' | 'e2b' | 'modal' | 'daytona' | 'firecracker';
  sandbox_id: string;     // container ID / sandbox_id / object_id
  sandbox_template: string;  // image/template
  sandbox_metadata: Record<string, string>;

  // Action
  action: 'exec' | 'read_file' | 'write_file' | 'lifecycle';
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  user: string;
  input: string;          // stdin (truncated)

  // Result
  exit_code: number;
  stdout: string;         // truncated, full via reference
  stderr: string;
  error: string | null;

  // Timing
  started_at: string;     // ISO timestamp
  completed_at: string;
  duration_ms: number;
  timed_out: boolean;
  timeout_limit_s: number | null;

  // Resources
  resources: {
    cpu_count: number;
    memory_mb: number;
    cpu_used_pct: number | null;
    memory_used_bytes: number | null;
  };

  // Lifecycle (when action = 'lifecycle')
  lifecycle_state?: 'creating' | 'started' | 'stopped' | 'destroyed' | 'error' | 'oom';
  previous_state?: string;
}
```

### Provider-Specific Receiver 实现要点

#### Docker Receiver
- 订阅 `docker events` stream (container start/stop/kill/die/oom/exec_create/exec_start/exec_die)
- 包装 `exec_create` + `exec_start` API 调用
- `docker stats` 流式获取 CPU/memory 指标
- 超时处理: PID 检查 + SIGTERM (SWE-bench 模式)
- OOM 检测: exit code 137 或专用 oom 事件

#### E2B Receiver
- 包装 `sandbox.commands.run()` / `sandbox.commands.start()`
- CommandResult: stdout, stderr, exit_code, error
- 轮询 `SandboxMetrics` (cpu_used_pct, mem_used, disk_used)
- Sandbox 生命周期: pause/kill/auto_resume

#### Modal Receiver
- 包装 `Sandbox.exec()` 调用
- `ContainerProcess.wait()` 获取最终结果
- 流式 stdout/stderr via iterator
- 无内建遥测, 必须在调用层插桩

#### Inspect AI 参考实现 (最佳参考)
```
SandboxEnvironmentProxy 拦截所有调用:
1. 记录 timestamp (开始)
2. 从当前 trace context 获取 parent span_id
3. 执行实际沙箱操作
4. 记录 completed timestamp
5. 发射 SandboxEvent 到 transcript
```

事件字段:
- action: exec | read_file | write_file
- cmd, options (cwd/env/user/timeout)
- result (exit code), output (截断到 100 行)
- timing: timestamp + completed

### 关键设计决策

1. **输出截断**: 所有框架都截断 (Inspect AI: 20 行显示, 10 MiB 硬限制). Receiver 存完整输出到 blob store, 事件中保留截断预览.
2. **Correlation**: 通过 AsyncLocalStorage 从当前 agent span context 获取 span_id, 关联到沙箱事件.
3. **长时间进程**: 立即发射 `pending: true` 的开始事件, 流式追加 stdout, 最终发射完成事件.
4. **文件 I/O 作为一等事件**: read_file/write_file 和 exec 同等重要, 是理解 agent 在沙箱中做了什么的关键.
