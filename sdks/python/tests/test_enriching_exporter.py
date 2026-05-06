from unittest.mock import MagicMock

from opentelemetry.sdk.trace.export import SpanExportResult

from ho_sdk.enriching_exporter import EnrichingExporter


def _mock_span(attrs=None):
    span = MagicMock()
    span.attributes = attrs or {}
    span.name = "test-span"
    span.context = MagicMock()
    span.kind = MagicMock()
    span.parent = None
    span.start_time = 0
    span.end_time = 1000
    span.status = MagicMock()
    span.events = []
    span.links = []
    span.resource = MagicMock()
    span.instrumentation_info = MagicMock()
    return span


class MockEnricher:
    def enrich(self, span, attrs):
        return {**attrs, "enriched": True}


class CostEnricher:
    def enrich(self, span, attrs):
        input_tokens = attrs.get("gen_ai.usage.input_tokens", 0)
        cost = input_tokens * 0.00001
        return {**attrs, "ho.cost.usd": cost}


def test_enriching_exporter_applies_enrichers():
    inner = MagicMock()
    inner.export.return_value = SpanExportResult.SUCCESS

    exporter = EnrichingExporter(inner, [MockEnricher()])
    span = _mock_span({"key": "value"})

    result = exporter.export([span])
    assert result == SpanExportResult.SUCCESS
    inner.export.assert_called_once()

    enriched_spans = inner.export.call_args[0][0]
    assert len(enriched_spans) == 1
    assert enriched_spans[0].attributes["enriched"] is True
    assert enriched_spans[0].attributes["key"] == "value"


def test_enricher_chaining():
    inner = MagicMock()
    inner.export.return_value = SpanExportResult.SUCCESS

    exporter = EnrichingExporter(inner, [MockEnricher(), CostEnricher()])
    span = _mock_span({"gen_ai.usage.input_tokens": 1000})

    exporter.export([span])

    enriched_spans = inner.export.call_args[0][0]
    attrs = enriched_spans[0].attributes
    assert attrs["enriched"] is True
    assert attrs["ho.cost.usd"] == 0.01


def test_enriching_exporter_shutdown():
    inner = MagicMock()
    exporter = EnrichingExporter(inner, [])
    exporter.shutdown()
    inner.shutdown.assert_called_once()
