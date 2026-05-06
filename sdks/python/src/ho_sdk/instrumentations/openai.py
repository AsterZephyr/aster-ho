"""Auto-instrumentation for the OpenAI Python SDK."""

import functools
from typing import Any

from opentelemetry import trace

from ho_sdk.attributes import GenAIAttributes, HoAttributes


def patch_openai() -> None:
    """Monkey-patch openai.chat.completions.create to emit spans."""
    try:
        import openai
    except ImportError:
        return

    _original_create = openai.resources.chat.completions.Completions.create

    @functools.wraps(_original_create)
    def _instrumented_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        tracer = trace.get_tracer("ho-sdk.openai")
        model = kwargs.get("model", "unknown")

        with tracer.start_as_current_span(f"chat {model}") as span:
            span.set_attribute(GenAIAttributes.SYSTEM, "openai")
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
                span.set_attribute(GenAIAttributes.USAGE_INPUT_TOKENS, response.usage.prompt_tokens)
                span.set_attribute(GenAIAttributes.USAGE_OUTPUT_TOKENS, response.usage.completion_tokens)

            if hasattr(response, "model"):
                span.set_attribute(GenAIAttributes.RESPONSE_MODEL, response.model)

            if hasattr(response, "choices") and response.choices:
                reasons = [c.finish_reason for c in response.choices if c.finish_reason]
                if reasons:
                    span.set_attribute(GenAIAttributes.RESPONSE_FINISH_REASON, reasons)

            return response

    openai.resources.chat.completions.Completions.create = _instrumented_create
