from unittest.mock import MagicMock, patch

from opentelemetry import trace

from ho_sdk.config import HoConfig
from ho_sdk.sdk import init, shutdown


def test_init_returns_tracer():
    config = HoConfig(dev=True, auto_shutdown=False)
    tracer = init(config)
    assert tracer is not None
    shutdown()


def test_init_with_default_config():
    config = HoConfig(dev=True, auto_shutdown=False)
    tracer = init(config)
    assert tracer is not None
    shutdown()


def test_init_creates_spans():
    config = HoConfig(dev=True, auto_shutdown=False)
    tracer = init(config)

    with tracer.start_as_current_span("test-operation") as span:
        span.set_attribute("test.key", "value")
        assert span.is_recording()

    shutdown()


def test_shutdown_is_idempotent():
    config = HoConfig(dev=True, auto_shutdown=False)
    init(config)
    shutdown()
    shutdown()
