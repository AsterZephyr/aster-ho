"""Auto-instrumentation for the Anthropic Python SDK."""

import functools
from typing import Any

from opentelemetry import trace

from ho_sdk.attributes import GenAIAttributes


def patch_anthropic() -> None:
    """Monkey-patch anthropic.messages.create to emit spans."""
    try:
        import anthropic
    except ImportError:
        return

    _original_create = anthropic.resources.messages.Messages.create

    @functools.wraps(_original_create)
    def _instrumented_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        tracer = trace.get_tracer("ho-sdk.anthropic")
        model = kwargs.get("model", "unknown")

        with tracer.start_as_current_span(f"chat {model}") as span:
            span.set_attribute(GenAIAttributes.SYSTEM, "anthropic")
            span.set_attribute(GenAIAttributes.REQUEST_MODEL, model)

            if "temperature" in kwargs:
                span.set_attribute(GenAIAttributes.REQUEST_TEMPERATURE, kwargs["temperature"])
            if "max_tokens" in kwargs:
                span.set_attribute(GenAIAttributes.REQUEST_MAX_TOKENS, kwargs["max_tokens"])

            try:
                response = _original_create(self, *args, **kwargs)
            except Exception as exc:
                span.set_status(trace.StatusCode.ERROR, str(exc))
                raise

            if hasattr(response, "usage") and response.usage:
                span.set_attribute(GenAIAttributes.USAGE_INPUT_TOKENS, response.usage.input_tokens)
                span.set_attribute(GenAIAttributes.USAGE_OUTPUT_TOKENS, response.usage.output_tokens)

            if hasattr(response, "model"):
                span.set_attribute(GenAIAttributes.RESPONSE_MODEL, response.model)

            if hasattr(response, "stop_reason") and response.stop_reason:
                span.set_attribute(GenAIAttributes.RESPONSE_FINISH_REASON, [response.stop_reason])

            return response

    anthropic.resources.messages.Messages.create = _instrumented_create
