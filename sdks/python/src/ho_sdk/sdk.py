"""Core SDK initialization and shutdown."""

import atexit
import signal
import sys
from typing import Any

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
    SpanExporter,
)

from ho_sdk.config import HoConfig
from ho_sdk.enriching_exporter import EnrichingExporter

_provider: TracerProvider | None = None
_shutdown_registered = False


def init(config: HoConfig | None = None) -> trace.Tracer:
    """Initialize ho SDK with the given configuration.

    Returns a Tracer instance for creating spans.
    """
    global _provider, _shutdown_registered

    if config is None:
        config = HoConfig()

    resource = Resource.create({"service.name": config.service_name})
    _provider = TracerProvider(resource=resource)

    exporter = _build_exporter(config)
    if config.enrichers:
        exporter = EnrichingExporter(exporter, config.enrichers)

    processor = BatchSpanProcessor(exporter)
    _provider.add_span_processor(processor)

    trace.set_tracer_provider(_provider)

    if config.auto_shutdown and not _shutdown_registered:
        atexit.register(shutdown)
        signal.signal(signal.SIGTERM, _signal_handler)
        _shutdown_registered = True

    return trace.get_tracer("ho-sdk")


def shutdown() -> None:
    """Flush and shut down the tracer provider."""
    global _provider
    if _provider is not None:
        _provider.shutdown()
        _provider = None


def _build_exporter(config: HoConfig) -> SpanExporter:
    if config.dev:
        return ConsoleSpanExporter()

    endpoint = config.endpoint or "http://localhost:4318"

    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )

        return OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")
    except ImportError:
        return ConsoleSpanExporter()


def _signal_handler(signum: int, frame: Any) -> None:
    shutdown()
    sys.exit(0)
