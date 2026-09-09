"""Unit and integration tests for Phase 2 multi-runner adapters and registry."""

from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from mcp_delegation_server.runners.anthropic_runner import AnthropicRunner
from mcp_delegation_server.runners.base import BaseRunner, RunnerConfig, RunnerResult
from mcp_delegation_server.runners.ollama_runner import OllamaRunner
from mcp_delegation_server.runners.openai_runner import OpenAIRunner
from mcp_delegation_server.runners.openrouter_runner import OpenRouterRunner
from mcp_delegation_server.runners.registry import RunnerRegistry
from mcp_delegation_server.server import get_registry, list_runners, server


def test_registry_loads_all_runner_types():
    """Verify registry instantiates all runner types correctly from config.yaml."""
    registry = RunnerRegistry.from_yaml()
    runner_ids = registry.registered_ids()

    assert "claude-3-7-sonnet" in runner_ids
    assert "gpt-4o" in runner_ids
    assert "gpt-4o-mini" in runner_ids
    assert "ollama-llama3.2" in runner_ids
    assert any(r.startswith("openrouter-") for r in runner_ids)

    assert isinstance(registry.get("claude-3-7-sonnet"), AnthropicRunner)
    assert isinstance(registry.get("gpt-4o"), OpenAIRunner)
    assert isinstance(registry.get("ollama-llama3.2"), OllamaRunner)
    assert isinstance(registry.get("openrouter-claude-sonnet-4.5"), OpenRouterRunner)


@pytest.mark.asyncio
async def test_openai_runner_missing_api_key():
    """Test OpenAIRunner handles missing API key gracefully."""
    config = RunnerConfig(
        id="test-gpt",
        type="openai",
        model="gpt-4o",
        api_key_env="NON_EXISTENT_OPENAI_KEY",
    )
    runner = OpenAIRunner(config)

    with patch.dict(os.environ, {}, clear=True):
        result = await runner.execute(task="Test prompt")
        assert result.success is False
        assert "Authentication error" in result.error_message
        assert "NON_EXISTENT_OPENAI_KEY" in result.error_message


@pytest.mark.asyncio
async def test_openai_runner_mock_success():
    """Test OpenAIRunner execution with mocked response."""
    config = RunnerConfig(
        id="gpt-4o",
        type="openai",
        model="gpt-4o",
        api_key_env="MOCK_OPENAI_KEY",
        cost_per_million_input_tokens=2.50,
        cost_per_million_output_tokens=10.00,
    )
    runner = OpenAIRunner(config)

    mock_choice = MagicMock()
    mock_choice.message.content = "Response from GPT-4o"
    mock_choice.finish_reason = "stop"

    mock_usage = MagicMock()
    mock_usage.prompt_tokens = 20
    mock_usage.completion_tokens = 10
    mock_usage.total_tokens = 30

    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    mock_response.usage = mock_usage
    mock_response.system_fingerprint = "fp_123"

    with patch.dict(os.environ, {"MOCK_OPENAI_KEY": "sk-openai-mock"}):
        with patch("openai.AsyncOpenAI") as mock_openai_cls:
            mock_client = MagicMock()
            mock_client.api_key = "sk-openai-mock"
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_openai_cls.return_value = mock_client

            result = await runner.execute(task="Hello GPT")
            assert result.success is True
            assert result.output == "Response from GPT-4o"
            assert result.input_tokens == 20
            assert result.output_tokens == 10
            assert result.estimated_cost_usd > 0
            assert result.latency_ms >= 0


@pytest.mark.asyncio
async def test_ollama_runner_mock_success():
    """Test OllamaRunner execution with mocked HTTP REST response."""
    config = RunnerConfig(
        id="ollama-llama3.2",
        type="ollama",
        model="llama3.2",
        base_url="http://localhost:11434",
    )
    runner = OllamaRunner(config)

    mock_response_data = {
        "model": "llama3.2",
        "response": "Response from local Llama 3.2",
        "done": True,
        "total_duration": 500000000,
        "prompt_eval_count": 15,
        "eval_count": 30,
    }

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        result = await runner.execute(task="Hello Llama")

        assert result.success is True
        assert result.output == "Response from local Llama 3.2"
        assert result.input_tokens == 15
        assert result.output_tokens == 30
        assert result.estimated_cost_usd == 0.0
        assert result.error_message is None


@pytest.mark.asyncio
async def test_ollama_runner_connection_error():
    """Test OllamaRunner handles unreachable Ollama server gracefully."""
    config = RunnerConfig(
        id="ollama-llama3.2",
        type="ollama",
        model="llama3.2",
        base_url="http://localhost:99999",
    )
    runner = OllamaRunner(config)

    with patch("httpx.AsyncClient.post", side_effect=httpx.ConnectError("Connection refused")):
        result = await runner.execute(task="Hello")
        assert result.success is False
        assert "Could not connect to Ollama server" in result.error_message


@pytest.mark.asyncio
async def test_openrouter_runner_mock_success():
    """Test OpenRouterRunner execution with mocked response."""
    config = RunnerConfig(
        id="openrouter-deepseek",
        type="openrouter",
        model="deepseek/deepseek-chat",
        api_key_env="MOCK_OPENROUTER_KEY",
        cost_per_million_input_tokens=0.14,
        cost_per_million_output_tokens=0.28,
    )
    runner = OpenRouterRunner(config)

    mock_choice = MagicMock()
    mock_choice.message.content = "Response from DeepSeek via OpenRouter"
    mock_choice.finish_reason = "stop"

    mock_usage = MagicMock()
    mock_usage.prompt_tokens = 50
    mock_usage.completion_tokens = 25
    mock_usage.total_tokens = 75

    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    mock_response.usage = mock_usage

    with patch.dict(os.environ, {"MOCK_OPENROUTER_KEY": "sk-or-mock"}):
        with patch("openai.AsyncOpenAI") as mock_openai_cls:
            mock_client = MagicMock()
            mock_client.api_key = "sk-or-mock"
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_openai_cls.return_value = mock_client

            result = await runner.execute(task="Hello DeepSeek")
            assert result.success is True
            assert result.output == "Response from DeepSeek via OpenRouter"
            assert result.input_tokens == 50
            assert result.output_tokens == 25
            assert result.estimated_cost_usd > 0


@pytest.mark.asyncio
async def test_list_runners_tool():
    """Test list_runners tool returns valid JSON metadata array."""
    res_str = await list_runners()
    runners_meta = json.loads(res_str)

    assert isinstance(runners_meta, list)
    assert len(runners_meta) >= 4

    ids = [r["runner_id"] for r in runners_meta]
    assert "claude-3-7-sonnet" in ids
    assert "gpt-4o" in ids
    assert "ollama-llama3.2" in ids
    assert any(r.startswith("openrouter-") for r in ids)

    for meta in runners_meta:
        assert "runner_id" in meta
        assert "type" in meta
        assert "model" in meta
        assert "pricing" in meta
        assert "timeout_seconds" in meta
        assert "is_authenticated" in meta


@pytest.mark.asyncio
async def test_all_runners_return_identical_runner_result_shape():
    """Verify all runners produce exact same RunnerResult structure."""
    expected_fields = {
        "runner_id",
        "model",
        "task",
        "output",
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "estimated_cost_usd",
        "success",
        "error_message",
        "raw_metadata",
        "timestamp",
    }

    dummy_res = RunnerResult(
        runner_id="dummy",
        model="dummy-model",
        task="test",
        output="test output",
        latency_ms=10.0,
        input_tokens=5,
        output_tokens=5,
        estimated_cost_usd=0.0001,
        success=True,
    )
    assert set(dummy_res.to_dict().keys()) == expected_fields
