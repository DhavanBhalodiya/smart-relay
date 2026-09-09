"""Runners package for MCP delegation server."""

from mcp_delegation_server.runners.base import BaseRunner, RunnerConfig, RunnerResult
from mcp_delegation_server.runners.anthropic_runner import AnthropicRunner
from mcp_delegation_server.runners.nvidia_runner import NVIDIARunner
from mcp_delegation_server.runners.openai_runner import OpenAIRunner
from mcp_delegation_server.runners.ollama_runner import OllamaRunner
from mcp_delegation_server.runners.openrouter_runner import OpenRouterRunner
from mcp_delegation_server.runners.registry import RunnerRegistry

__all__ = [
    "BaseRunner",
    "RunnerConfig",
    "RunnerResult",
    "AnthropicRunner",
    "NVIDIARunner",
    "OpenAIRunner",
    "OllamaRunner",
    "OpenRouterRunner",
    "RunnerRegistry",
]
