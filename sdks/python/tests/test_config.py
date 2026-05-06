from ho_sdk.config import HoConfig


def test_default_config():
    cfg = HoConfig()
    assert cfg.service_name == "ho-agent"
    assert cfg.endpoint is None
    assert cfg.enrichers == []
    assert cfg.dev is False
    assert cfg.auto_shutdown is True


def test_custom_config():
    cfg = HoConfig(service_name="my-agent", endpoint="http://localhost:9999", dev=True)
    assert cfg.service_name == "my-agent"
    assert cfg.endpoint == "http://localhost:9999"
    assert cfg.dev is True


def test_config_is_frozen():
    cfg = HoConfig()
    try:
        cfg.service_name = "mutated"  # type: ignore
        assert False, "Should have raised"
    except Exception:
        pass
