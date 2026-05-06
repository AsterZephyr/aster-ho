from typing import Any, Protocol

from opentelemetry.sdk.trace import ReadableSpan


class SpanEnricher(Protocol):
    """Protocol for span enrichers that add attributes to spans before export."""

    def enrich(self, span: ReadableSpan, attrs: dict[str, Any]) -> dict[str, Any]:
        """Return enriched attributes dict. Must not mutate the input."""
        ...
