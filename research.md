# Agent Harness Observability - Research Findings

## 1. OpenAI Agents SDK Tracing Architecture

**Core Pipeline**: Trace -> Span -> Processor -> Exporter (类 OTEL 但为 Agent 领域定制)

### 关键抽象
| 层 | 职责 | 关键特性 |
|---|------|---------|
| Trace | 顶层容器 | trace_id, workflow_name, group_id(关联对话), metadata |
| Span | 单次操作 | 强类型 SpanData, parent_id 嵌套, error state |
| TracingProcessor | 事件订阅 | on_trace_start/end, on_span_start/end |
| TracingExporter | 输出后端 | export(items), 支持自定义 |

### Span 类型 (12+ 种, 强类型领域模型)
- AgentSpanData: agent 执行 (name, handoffs, tools, output_type)
- GenerationSpanData: LLM 生成 (input messages, output, model, usage)
- FunctionSpanData: 工具执行 (name, input, output, mcp_data)
- HandoffSpanData: agent 切换 (from_agent, to_agent)
- GuardrailSpanData: 护栏检查 (name, triggered)
- ResponseSpanData, TaskSpanData, TurnSpanData, CustomSpanData...

### 关键设计决策
- **NoOp 模式**: 禁用时返回 NoOpTrace/NoOpSpan, 消除空检查
- **contextvars**: 异步安全的上下文传播, 自动 parent-child 嵌套
- **BatchTraceProcessor**: 后台线程批量导出 (queue 8192, batch 128, 5s delay)
- **BackendSpanExporter**: 指数退避+抖动, 字段截断 100KB, 多租户 API key
- **Lazy 初始化**: 首次使用才创建, 避免 import 副作用
- **Trace 重挂载**: ReattachedTrace + TraceState 支持跨进程恢复

---

## 2. Anthropic/Claude Code 可观测架构

### 内部遥测系统
- **666 个事件名**, 前缀 `tengu_`
- 事件信封: event_name, session_id, additional_metadata, auth, parent_session_id
- MCP 工具名默认脱敏为 `mcp_tool`, 详细日志需 `OTEL_LOG_TOOL_DETAILS`

### 主要事件族
| 族 | 数量 | 用途 |
|---|------|------|
| mcp_* | ~50 | MCP server 生命周期, auth, tool calls |
| bash_* | ~47 | Shell 安全, AST 复杂度, 命令执行 |
| bridge_* | ~46 | 远程执行, WebSocket, 重连 |
| session_* | ~29 | Session 生命周期, memory, compaction |
| tool_* | ~23 | 工具权限、成功、失败 |
| agent_* | ~21 | Agent 行为追踪 |
| streaming_* | ~17 | 流式响应 |

### OpenTelemetry 集成
```
claude_code.cost.usage        -- Counter (USD)
claude_code.token.usage       -- Counter (by type: input/output/cacheCreation/cacheRead)
claude_code.session.count     -- Counter
claude_code.commit.count      -- Counter
claude_code.lines_of_code.count -- Counter
```
基础设施: OTEL Collector (gRPC:4317) -> Prometheus -> Grafana

### Agent SDK 可观测性
- **Hooks 为主要扩展点**: PreToolUse / PostToolUse 回调
- SubagentTracker 模式: JSONL 结构化日志 (tool_call_start/complete)
- Session 存储: JSONL transcript at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`

---

## 3. 可观测框架全景

### LLM 专用工具对比

| 工具 | 许可 | 追踪模型 | Agent 支持 | 成本追踪 | OTEL 原生 | 自托管 | 评估内建 |
|------|------|----------|-----------|----------|-----------|--------|---------|
| Langfuse | MIT | SDK 装饰器 + OTEL 桥接 | 强 | 模型级 | 桥接 | 是 | 是 |
| Arize Phoenix | Apache | 纯 OTEL + OpenInference | 强 | 基础 | 是 | 是 | 强 |
| W&B Weave | 商业 | @weave.op() + OTEL | 强 | 是 | 桥接 | 否 | 强 |
| Helicone | OSS | Proxy/Gateway | Session 级 | 自动 | 否 | 是 | 否 |
| LangSmith | 商业 | LangChain 回调 | LC 最强 | 是 | 否 | 否 | 是 |

### OpenTelemetry GenAI 语义约定 (核心标准)

**Span 类型**:
- `invoke_agent` -- agent 调用
- `chat` -- LLM 对话
- `tools/call` -- 工具/MCP 调用
- `execute_tool` -- 工具执行
- `retrieval` -- RAG 检索

**关键属性**:
```
gen_ai.operation.name       -- chat, invoke_agent, execute_tool
gen_ai.agent.name / .id / .version
gen_ai.conversation.id      -- session/thread
gen_ai.usage.input_tokens / .output_tokens / .cache_read.input_tokens
gen_ai.tool.call.arguments / .result  (opt-in, 敏感)
mcp.session.id / mcp.method.name
```

**Agent + MCP Tool Call 的 Trace 结构**:
```
invoke_agent (root)
  |-- chat {model} (CLIENT)
  |     |-- POST (HTTP to LLM)
  |-- tools/call get-weather (CLIENT, MCP client)
  |     |-- POST (transport)
  |     |-- tools/call get-weather (SERVER, MCP server)
  |-- chat {model} (follow-up)
```

### 插件化架构参考

**Pattern 1: Exporter Interface (OTEL 风格)**
- 解耦 span 生产与消费
- 多个 exporter 并行运行

**Pattern 2: Processor Chain (OTEL Collector 风格)**
- Receiver -> Processor1 -> Processor2 -> Exporter
- 可组合、可重排

**Pattern 3: Callback/Listener (Airflow 风格)**
- on_agent_start, on_tool_call, on_llm_call, on_agent_end
- 多回调共存

**Pattern 4: Provider Package (Airflow 2.0 风格)**
- 独立版本化的 provider 包
- Entry point 自动发现
- Operators/Hooks/Sensors 分离

---

## 4. Agent Harness 框架对比

| 框架 | 运行标识 | 沙箱 | 可观测深度 | 超时 | 追踪标准 |
|------|---------|------|-----------|------|---------|
| SWE-bench | run_id | Docker 3层 | 低(日志+报告) | Thread+kill | 无 |
| METR | 生命周期隐式 | Docker+aux VM | 低(score+时间戳) | 平台委托 | 无 |
| Inspect AI | run_id + EvalLog | 抽象 SandboxEnv | **极高**(20+事件类型, span 层级) | 多维限制 | 自定义事件 |
| LangGraph | thread_id + checkpoint_id | 无 | 中(checkpoint, callback) | 图执行步 | LangChain 回调 |
| AutoGen | message_id | 无 | 中(OTEL) | CancellationToken | OTEL |
| CrewAI | Crew span | 无 | 中(OTEL) | Signal | OTEL |
| Mastra | currentRunId + currentTraceId | 无 | 中-高(Proxy tracing) | Abort signal | OTEL |

### Inspect AI 亮点 (UK AISI)
- 20+ 强类型事件: ModelEvent, ToolEvent, SandboxEvent, ScoreEvent, SpanBeginEvent...
- 多维资源限制: message_limit, token_limit, time_limit, cost_limit
- Working time vs clock time 区分 (排除等待信号量时间)
- 实时日志查看器 (React 前端)

### METR Task Standard 亮点
- 只定义环境和评分契约, 不规定 agent 交互方式
- 最强可组合性: 任何 agent 框架都能对接

---

## 5. Cursor 团队实战经验 (来自 Blog)

### 核心判断
> "模型的上限决定天花板，但 harness 决定模型实际能跑多远。"

### 上下文策略演进
- 2024 旧范式: 守卫式 (大量护栏, 静态注入上下文)
- 2026 新范式: 动态获取式 (瘦身静态上下文, 把"取什么"的权力交还模型)
- 趋势: "减少喂养, 增加感官"

### 衡量体系 (三层)
1. 离线基准: 公开 benchmark + 自研 CursorBench
2. 在线 A/B: 多 harness 变体并行投放真实用户
3. 质量指标: 代码留存率 + LLM 判读用户回应

### 错误分类与告警
- InvalidArguments / UnexpectedEnvironment / ProviderError / UserAborted / Timeout
- 未知错误 = bug, 超阈值即报警
- 按工具、按模型分别建立基线的异常检测
- Agent 自动翻日志 -> 建/更新 ticket -> 调度 Agent 修复

### 模型定制与切换
- 工具格式贴合训练分布: OpenAI 用 patch, Anthropic 用字符串替换
- 中途换模型 = OOD 输入 + cache miss + 工具集切换
- 解法: 注入接手指令 + 劝阻调用旧工具 + 建议用 subagent 隔离

### Multi-Agent 是 harness 问题
- 派哪个 agent 接手
- 如何按目标 agent 的强项重组任务描述
- 如何缝合多 agent 产出为连贯工作流

---

## 6. Tool Calling Schema Normalization (跨模型核心痛点)

### 三家协议差异

| 维度 | OpenAI | Anthropic | Gemini |
|------|--------|-----------|--------|
| 定义格式 | functions[] / tools[] | tools[] with input_schema | functionDeclarations[] |
| 调用格式 | tool_calls[].function.arguments (JSON string) | content[].type="tool_use", input (object) | functionCall.args (object) |
| 返回格式 | role="tool", tool_call_id | role="user", content[].type="tool_result", tool_use_id | functionResponse |
| 并行调用 | 原生支持 | 原生支持 | 部分支持 |
| 必填/可选 | required / auto / none | auto | mode: AUTO/ANY/NONE |

### 已有 normalization 方案
- **LiteLLM**: Proxy 层统一 100+ 模型的 tool calling, 但抽象泄漏多
- **Vercel AI SDK**: `tool()` 统一抽象, Zod schema, 自动转各家格式
- **Portkey**: Gateway 层转换
- **Instructor**: Pydantic schema -> 各家 function calling

### Harness 层需要做的
1. **Schema 标准化**: 内部用统一的 Tool Schema (类似 MCP 的 JSON Schema 定义)
2. **协议适配器**: per-provider adapter 处理 schema 转换 + 调用格式 + 结果解析
3. **行为对齐**: 处理各模型的 tool calling 怪癖 (如 Claude 有时输出 markdown 包裹的 JSON)
4. **验证层**: 模型输出的 tool call 在执行前先过 schema validation
