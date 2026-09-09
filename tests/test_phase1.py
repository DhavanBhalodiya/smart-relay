"""Unit and integration tests for Phase 1 of MCP Delegation Server."""

from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_delegation_server.runners.anthropic_runner import AnthropicRunner
from mcp_delegation_server.runners.base import BaseRunner, RunnerConfig, RunnerResult
from mcp_delegation_server.runners.registry import RunnerRegistry
from mcp_delegation_server.server import delegate_task, get_registry, server


def test_runner_result_serialization():
    """Test RunnerResult serialization to dict and JSON."""
    result = RunnerResult(
        runner_id="test-runner",
        model="claude-3-7-sonnet-20250219",
        task="Say hello",
        output="Hello there!",
        latency_ms=120.5,
        input_tokens=10,
        output_tokens=5,
        estimated_cost_usd=0.000105,
        success=True,
        error_message=None,
    )

    d = result.to_dict()
    assert d["runner_id"] == "test-runner"
    assert d["success"] is True
    assert d["output"] == "Hello there!"

    j_str = result.to_json()
    parsed = json.loads(j_str)
    assert parsed["runner_id"] == "test-runner"
    assert parsed["latency_ms"] == 120.5


def test_cost_calculation():
    """Test token cost calculation in BaseRunner."""
    config = RunnerConfig(
        id="test-runner",
        type="anthropic",
        model="test-model",
        cost_per_million_input_tokens=3.0,
        cost_per_million_output_tokens=15.0,
    )
    runner = AnthropicRunner(config)
    # 1000 input tokens = 0.003 USD, 1000 output tokens = 0.015 USD => 0.018 USD
    cost = runner.calculate_cost(input_tokens=1000, output_tokens=1000)
    assert cost == 0.018


def test_registry_loading_from_yaml(tmp_path):
    """Test RunnerRegistry loading from config.yaml."""
    config_content = """
server:
  name: "test-server"
  max_concurrency: 3
  default_timeout_seconds: 30.0

runners:
  test-claude:
    type: "anthropic"
    model: "claude-3-7-sonnet-20250219"
    api_key_env: "ANTHROPIC_API_KEY"
    cost_per_million_input_tokens: 3.00
    cost_per_million_output_tokens: 15.00
    default_params:
      max_tokens: 1024
      temperature: 0.5
"""
    config_file = tmp_path / "config.yaml"
    config_file.write_text(config_content)

    registry = RunnerRegistry.from_yaml(config_file)
    assert "test-claude" in registry.registered_ids()
    runner = registry.get("test-claude")
    assert runner is not None
    assert runner.model == "claude-3-7-sonnet-20250219"
    assert runner.config.cost_per_million_input_tokens == 3.00
    assert runner.config.default_params["max_tokens"] == 1024


@pytest.mark.asyncio
async def test_anthropic_runner_missing_api_key():
    """Test AnthropicRunner returns structured error when API key is missing."""
    config = RunnerConfig(
        id="test-claude",
        type="anthropic",
        model="claude-3-7-sonnet-20250219",
        api_key_env="NON_EXISTENT_TEST_KEY_ENV",
    )
    runner = AnthropicRunner(config)

    with patch.dict(os.environ, {}, clear=True):
        result = await runner.execute(task="Test prompt")
        assert result.success is False
        assert "Authentication error" in result.error_message
        assert "NON_EXISTENT_TEST_KEY_ENV" in result.error_message
        assert result.output == ""


@pytest.mark.asyncio
async def test_anthropic_runner_mock_success():
    """Test AnthropicRunner successful execution with mocked SDK response."""
    config = RunnerConfig(
        id="claude-3-7-sonnet",
        type="anthropic",
        model="claude-3-7-sonnet-20250219",
        api_key_env="MOCK_ANTHROPIC_KEY",
        cost_per_million_input_tokens=3.00,
        cost_per_million_output_tokens=15.00,
    )
    runner = AnthropicRunner(config)

    mock_text_block = MagicMock()
    mock_text_block.type = "text"
    mock_text_block.text = "This is a response from Claude."

    mock_usage = MagicMock()
    mock_usage.input_tokens = 25
    mock_usage.output_tokens = 10
    mock_usage.cache_creation_input_tokens = 0
    mock_usage.cache_read_input_tokens = 0

    mock_response = MagicMock()
    mock_response.content = [mock_text_block]
    mock_response.usage = mock_usage
    mock_response.stop_reason = "end_turn"
    mock_response.stop_sequence = None

    with patch.dict(os.environ, {"MOCK_ANTHROPIC_KEY": "sk-ant-test-key-12345"}):
        with patch("anthropic.AsyncAnthropic") as mock_client_cls:
            mock_client_instance = MagicMock()
            mock_client_instance.api_key = "sk-ant-test-key-12345"
            mock_client_instance.messages = MagicMock()
            mock_client_instance.messages.create = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client_instance

            result = await runner.execute(task="Hello Claude", params={"temperature": 0.2})

            assert result.success is True
            assert result.output == "This is a response from Claude."
            assert result.input_tokens == 25
            assert result.output_tokens == 10
            assert result.estimated_cost_usd > 0
            assert result.error_message is None
            assert result.latency_ms >= 0


@pytest.mark.asyncio
async def test_delegate_task_unknown_runner():
    """Test delegate_task handles unknown runner IDs gracefully."""
    raw_res = await delegate_task(task="Ping", runner_id="non-existent-runner")
    data = json.loads(raw_res)
    assert data["success"] is False
    assert "Runner 'non-existent-runner' is not registered" in data["error_message"]


@pytest.mark.asyncio
async def test_mcp_server_tool_registration():
    """Verify delegate_task tool is registered with MCPServer."""
    tools = server._tool_manager.list_tools()
    tool_names = [t.name for t in tools]
    assert "delegate_task" in tool_names

    delegate_tool = next(t for t in tools if t.name == "delegate_task")
    assert "task" in delegate_tool.parameters["properties"]
    assert "runner_id" in delegate_tool.parameters["properties"]
    assert "params" in delegate_tool.parameters["properties"]
