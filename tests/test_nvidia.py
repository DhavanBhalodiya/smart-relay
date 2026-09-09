"""Tests for NVIDIA NIM / API catalog runner."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from mcp_delegation_server.runners.base import RunnerConfig
from mcp_delegation_server.runners.nvidia_runner import NVIDIARunner
from mcp_delegation_server.runners.registry import RunnerRegistry


def test_nvidia_runner_instantiation_from_config():
    """Verify registry loads nvidia runners correctly."""
    registry = RunnerRegistry.from_yaml()
    runner = registry.get("nemotron-3-super-120b-a12b")
    assert runner is not None
    assert isinstance(runner, NVIDIARunner)
    assert runner.model == "nvidia/nemotron-3-super-120b-a12b"
    assert runner.config.base_url == "https://integrate.api.nvidia.com/v1"


@pytest.mark.asyncio
async def test_nvidia_runner_mock_execution():
    """Verify NVIDIARunner executes using OpenAI SDK with NVIDIA base URL."""
    config = RunnerConfig(
        id="nvidia-llama-70b",
        type="nvidia",
        model="meta/llama-3.3-70b-instruct",
        api_key_env="MOCK_NVIDIA_KEY",
        base_url="https://integrate.api.nvidia.com/v1",
        cost_per_million_input_tokens=0.70,
        cost_per_million_output_tokens=0.90,
    )
    runner = NVIDIARunner(config)

    mock_choice = MagicMock()
    mock_choice.message.content = "Response from NVIDIA Llama 70B"
    mock_choice.finish_reason = "stop"

    mock_usage = MagicMock()
    mock_usage.prompt_tokens = 30
    mock_usage.completion_tokens = 20
    mock_usage.total_tokens = 50

    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    mock_response.usage = mock_usage

    with patch.dict(os.environ, {"MOCK_NVIDIA_KEY": "nvapi-mock-key"}):
        with patch("openai.AsyncOpenAI") as mock_openai_cls:
            mock_client = MagicMock()
            mock_client.api_key = "nvapi-mock-key"
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_openai_cls.return_value = mock_client

            result = await runner.execute(task="Explain GPUs")

            assert result.success is True
            assert result.output == "Response from NVIDIA Llama 70B"
            assert result.input_tokens == 30
            assert result.output_tokens == 20
            assert result.estimated_cost_usd > 0
            assert result.runner_id == "nvidia-llama-70b"
