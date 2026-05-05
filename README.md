<h1 align="center">aster-ho</h1>

<p align="center">
  <strong>Agent Harness Observability</strong> — detect errors, context rot, and regressions in your AI agent systems before users do.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> |
  <a href="#what-it-does">What It Does</a> |
  <a href="#packages">Packages</a> |
  <a href="#cli">CLI</a> |
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## What It Does

**aster-ho** is an observability framework purpose-built for AI agent harnesses. It instruments your LLM calls, tool invocations, and agent loops — then detects problems automatically:

| Problem | Detection |
|---------|-----------|
| Tool call errors spike after a model update | Per-model x tool baselines + z-score anomaly alerts |
| Model loops on the same tool call | Context rot: repeated calls pattern |
| One tool failure causes a cascade | Context rot: error cascade detection |
| Prompt grows uncontrollably | Context rot: token bloat detection |
| Unknown errors accumulate silently | Fingerprinted, tracked, auto-ticketed when count exceeds threshold |

When something goes wrong, aster-ho can:
- Create a GitHub Issue or Linear ticket automatically
- Generate a weekly ops report (Markdown or JSON)
- Pinpoint the exact trigger span in a trace with `ho root-cause`
- Compare error rates before and after a harness change

## Quick Start

```bash
# Install
pnpm add @ho/sdk @ho/instrumentation-openai @ho/exporter-file

# Instrument your agent
import { init } from "@ho/sdk";
import { OpenAIInstrumentation } from "@ho/instrumentation-openai";
import { FileExporter } from "@ho/exporter-file";

init({
  serviceName: "my-agent",
  instrumentations: [new OpenAIInstrumentation()],
  exporters: [new FileExporter({ filePath: "./traces.jsonl" })],
});

// That's it. All OpenAI calls are now traced.
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Data Ingestion                                                  │
│  ┌──────────────────┐  ┌─────────────────────────────────────┐  │
│  │ Auto-Instrument  │  │ Receivers                           │  │
│  │ OpenAI, Anthropic│  │ SWE-bench, Inspect AI, METR        │  │
│  │                  │  │ Docker, E2B, Modal sandboxes        │  │
│  └────────┬─────────┘  └────────────────┬────────────────────┘  │
└───────────┼──────────────────────────────┼──────────────────────┘
            │                              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Processing Pipeline (@ho/sdk)                                   │
│                                                                  │
│  Span → CostEnricher → ErrorClassify → ContextRot → AlertProc  │
│              ($)          (category)     (rot type)    (z-score) │
└────────────────────────────────┬────────────────────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌──────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ File/Langfuse│  │ Prometheus /metrics│  │ Baseline (SQLite)  │
│ (traces)     │  │ (real-time)        │  │ (anomaly detection)│
└──────────────┘  └────────────────────┘  └─────────┬──────────┘
                                                     │
                                          ┌──────────┴──────────┐
                                          ▼                     ▼
                                 ┌──────────────┐    ┌────────────────┐
                                 │ Auto-Ticket  │    │ CLI Reports    │
                                 │ (GH / Linear)│    │ compare/report │
                                 └──────────────┘    └────────────────┘
```

> Full interactive diagram: [`docs/architecture.excalidraw`](docs/architecture.excalidraw) (open with [excalidraw.com](https://excalidraw.com))

## Packages

### Core

| Package | Description |
|---------|-------------|
| [`@ho/sdk`](packages/sdk) | Core SDK — `init()`, tracing, EnrichingExporter pipeline |
| [`@ho/cli`](packages/cli) | CLI tool — validate, serve, replay, baseline, compare, report, root-cause |

### Instrumentation

| Package | Description |
|---------|-------------|
| [`@ho/instrumentation-openai`](packages/instrumentation-openai) | Auto-instrument OpenAI SDK (chat, streaming, embeddings) |
| [`@ho/instrumentation-anthropic`](packages/instrumentation-anthropic) | Auto-instrument Anthropic SDK |

### Enrichers

| Package | Description |
|---------|-------------|
| [`@ho/enricher-cost`](packages/enricher-cost) | Token-to-USD cost calculation per model |
| [`@ho/enricher-error-classify`](packages/enricher-error-classify) | 14-category error classification + fingerprinting |
| [`@ho/context-rot`](packages/context-rot) | Detect token bloat, error cascades, repeated tool calls |

### Exporters

| Package | Description |
|---------|-------------|
| [`@ho/exporter-file`](packages/exporter-file) | JSONL trace export |
| [`@ho/exporter-langfuse`](packages/exporter-langfuse) | Export to Langfuse |
| [`@ho/exporter-prometheus`](packages/exporter-prometheus) | Prometheus metrics endpoint + recording rules |

### Ops & Automation

| Package | Description |
|---------|-------------|
| [`@ho/alert-processor`](packages/alert-processor) | Sliding window alerts + z-score anomaly detection |
| [`@ho/baseline`](packages/baseline) | SQLite baseline store — per-(model, tool) stats, anomaly API |
| [`@ho/ticket-provider`](packages/ticket-provider) | Auto-create tickets (GitHub Issues, Linear) with dedup |

### Receivers

| Package | Description |
|---------|-------------|
| [`@ho/receiver-swe-bench`](packages/receiver-swe-bench) | Ingest SWE-bench evaluation reports |
| [`@ho/receiver-inspect-ai`](packages/receiver-inspect-ai) | Ingest Inspect AI eval logs |
| [`@ho/receiver-metr`](packages/receiver-metr) | Ingest METR Task Standard results |
| [`@ho/receiver-sandbox-docker`](packages/receiver-sandbox-docker) | Docker sandbox execution events |
| [`@ho/receiver-sandbox-e2b`](packages/receiver-sandbox-e2b) | E2B sandbox events |
| [`@ho/receiver-sandbox-modal`](packages/receiver-sandbox-modal) | Modal container events |

### Utilities

| Package | Description |
|---------|-------------|
| [`@ho/tool-normalize`](packages/tool-normalize) | Normalize tool call formats across providers |

## CLI

```bash
# Validate config
ho validate --config ho.config.yaml

# Run observability pipeline
ho serve --config ho.config.yaml

# Replay traces through pipeline
ho replay --file traces.jsonl

# Show per-model baselines
ho baseline show --format json

# Compare before/after a harness change
ho compare --base 7d --target 1d

# Weekly ops report
ho report weekly --format md

# Root-cause a failing trace
ho root-cause abc123-trace-id --file traces.jsonl
```

## Configuration

```yaml
# ho.config.yaml
service_name: my-agent

enrichers:
  - cost
  - error-classify
  - context-rot

exporters:
  file:
    path: ./traces.jsonl
  prometheus:
    port: 9464

baseline:
  db_path: ./ho-baseline.sqlite
  anomaly_zscore: 2.5

alerts:
  rules:
    - name: error-spike
      condition:
        type: anomaly
        metric: error_rate
        zscore_threshold: 3.0
        min_samples: 50
      window_ms: 300000
      notifiers: [ticket]

tickets:
  provider: github
  github:
    repo: your-org/your-repo
    labels: [ho-auto]
```

## Built On

- [OpenTelemetry](https://opentelemetry.io/) — tracing primitives and SDK
- [Semantic Conventions for GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/) — attribute naming
- TypeScript, pnpm workspaces, Turborepo

## License

[MIT](LICENSE)
