"""NVIDIA NIM / API Catalog runner implementation."""

from __future__ import annotations

import os
from mcp_delegation_server.runners.base import RunnerConfig
from mcp_delegation_server.runners.openai_runner import OpenAIRunner


class NVIDIARunner(OpenAIRunner):
    """Runner adapter for NVIDIA NIM & NVIDIA API Catalog models (build.nvidia.com)."""

    DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"

    def __init__(self, config: RunnerConfig) -> None:
        if not config.base_url:
            config.base_url = self.DEFAULT_BASE_URL
        if not config.api_key_env:
            config.api_key_env = "NVIDIA_API_KEY"
        super().__init__(config)

    def _get_api_key(self) -> str | None:
        env_var_name = self.config.api_key_env or "NVIDIA_API_KEY"
        return os.environ.get(env_var_name)
