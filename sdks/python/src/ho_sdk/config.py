from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class HoConfig:
    service_name: str = "ho-agent"
    endpoint: str | None = None
    enrichers: list[Any] = field(default_factory=list)
    dev: bool = False
    auto_shutdown: bool = True
