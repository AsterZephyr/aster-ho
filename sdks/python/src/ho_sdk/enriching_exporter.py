from typing import Any, Sequence

from opentelemetry.context import Context
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

from ho_sdk.enricher import SpanEnricher


class EnrichingExporter(SpanExporter):
    """Wraps an inner exporter and applies enrichers before delegating."""

    def __init__(self, inner: SpanExporter, enrichers: list[SpanEnricher]) -> None:
        self._inner = inner
        self._enrichers = enrichers

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        enriched_spans = [self._enrich_span(span) for span in spans]
        return self._inner.export(enriched_spans)

    def shutdown(self) -> None:
        self._inner.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return self._inner.force_flush(timeout_millis)

    def _enrich_span(self, span: ReadableSpan) -> ReadableSpan:
        attrs: dict[str, Any] = dict(span.attributes or {})
        for enricher in self._enrichers:
            attrs = enricher.enrich(span, attrs)
        return _SpanWithAttributes(span, attrs)


class _SpanWithAttributes(ReadableSpan):
    """Wraps a ReadableSpan with overridden attributes."""

    def __init__(self, original: ReadableSpan, attrs: dict[str, Any]) -> None:
        self._original = original
        self._attrs = attrs

    @property
    def name(self) -> str:
        return self._original.name

    @property
    def context(self):
        return self._original.context

    @property
    def kind(self):
        return self._original.kind

    @property
    def parent(self):
        return self._original.parent

    @property
    def start_time(self) -> int:
        return self._original.start_time

    @property
    def end_time(self) -> int:
        return self._original.end_time

    @property
    def status(self):
        return self._original.status

    @property
    def attributes(self) -> dict[str, Any]:
        return self._attrs

    @property
    def events(self):
        return self._original.events

    @property
    def links(self):
        return self._original.links

    @property
    def resource(self):
        return self._original.resource

    @property
    def instrumentation_info(self):
        return self._original.instrumentation_info

    def get_span_context(self):
        return self._original.get_span_context()

    def to_json(self, indent=4):
        return self._original.to_json(indent)
