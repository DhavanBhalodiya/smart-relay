"""Base classes and data models for LLM runners."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class RunnerConfig:
    """Configuration for a specific LLM runner."""

    id: str
    type: str  # "anthropic", "openai", "ollama", etc.
    model: str
    api_key_env: str | None = None
    base_url: str | None = None
    cost_per_million_input_tokens: float = 0.0
    cost_per_million_output_tokens: float = 0.0
    default_params: dict[str, Any] = field(default_factory=dict)
    timeout_seconds: float = 60.0


@dataclass
class RunnerResult:
    """Normalized result returned by any runner execution."""

    runner_id: str
    model: str
    task: str
    output: str
    latency_ms: float
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float
    success: bool
    error_message: str | None = None
    raw_metadata: dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        """Convert result to dictionary."""
        return asdict(self)

    def to_json(self, indent: int | None = 2) -> str:
        """Convert result to formatted JSON string."""
        return json.dumps(self.to_dict(), indent=indent)


class BaseRunner(ABC):
    """Abstract base class for all LLM backend runners."""

    def __init__(self, config: RunnerConfig) -> None:
        self.config = config

    @property
    def id(self) -> str:
        return self.config.id

    @property
    def model(self) -> str:
        return self.config.model

    def calculate_cost(self, input_tokens: int, output_tokens: int) -> float:
        """Calculate estimated cost in USD based on configured token rates."""
        input_cost = (input_tokens / 1_000_000.0) * self.config.cost_per_million_input_tokens
        output_cost = (output_tokens / 1_000_000.0) * self.config.cost_per_million_output_tokens
        return round(input_cost + output_cost, 6)

    @abstractmethod
    async def execute(
        self, task: str, params: dict[str, Any] | None = None
    ) -> RunnerResult:
        """Execute a task on the runner backend and return a normalized RunnerResult.
        
        Must never throw unhandled runner exceptions; errors should be captured
        and returned as RunnerResult(success=False, error_message=...).
        """
        pass
