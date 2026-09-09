"""Registry for discovering and managing configured LLM runners."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml

from mcp_delegation_server.runners.anthropic_runner import AnthropicRunner
from mcp_delegation_server.runners.base import BaseRunner, RunnerConfig
from mcp_delegation_server.runners.nvidia_runner import NVIDIARunner
from mcp_delegation_server.runners.ollama_runner import OllamaRunner
from mcp_delegation_server.runners.openai_runner import OpenAIRunner
from mcp_delegation_server.runners.openrouter_runner import OpenRouterRunner

logger = logging.getLogger("mcp_delegation_server.registry")


class RunnerRegistry:
    """Registry maintaining active runner instances configured via config.yaml with auto-reload."""

    RUNNER_FACTORIES = {
        "anthropic": AnthropicRunner,
        "openai": OpenAIRunner,
        "ollama": OllamaRunner,
        "openrouter": OpenRouterRunner,
        "nvidia": NVIDIARunner,
    }

    def __init__(self, config_path: Path | None = None) -> None:
        self._runners: dict[str, BaseRunner] = {}
        self.server_config: dict[str, Any] = {}
        self.config_path: Path | None = config_path
        self._watched_files: dict[Path, float] = {}

    @classmethod
    def find_config_path(cls, custom_path: str | Path | None = None) -> Path:
        """Find the config file path searching standard locations."""
        if custom_path:
            p = Path(custom_path)
            if p.exists():
                return p.resolve()
            raise FileNotFoundError(f"Specified configuration file not found: {custom_path}")

        env_path = os.environ.get("MCP_CONFIG_PATH")
        if env_path:
            p = Path(env_path)
            if p.exists():
                return p.resolve()
            raise FileNotFoundError(f"Configuration file specified by MCP_CONFIG_PATH not found: {env_path}")

        # Search current working directory and project root
        candidates = [
            Path.cwd() / "config.yaml",
            Path.cwd() / "config.yml",
            Path(__file__).parent.parent.parent / "config.yaml",
            Path(__file__).parent.parent.parent / "config.yml",
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate.resolve()

        raise FileNotFoundError(
            "Could not locate config.yaml in current directory or project root. "
            "Set MCP_CONFIG_PATH environment variable to point to your config.yaml."
        )

    def reload(self) -> None:
        """Load or reload runners from the YAML config file and any included files."""
        if not self.config_path or not self.config_path.exists():
            return

        try:
            watched: dict[Path, float] = {}
            watched[self.config_path] = self.config_path.stat().st_mtime

            with open(self.config_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            self.server_config = data.get("server", {})
            runners_dict: dict[str, Any] = dict(data.get("runners", {}))

            # Process modular includes (e.g. includes: ["config/runners/nvidia.yaml", ...])
            includes = data.get("includes", [])
            if isinstance(includes, list):
                for inc in includes:
                    inc_path = Path(inc)
                    if not inc_path.is_absolute() and self.config_path:
                        inc_path = self.config_path.parent / inc_path

                    if inc_path.exists() and inc_path.is_file():
                        watched[inc_path] = inc_path.stat().st_mtime
                        try:
                            with open(inc_path, "r", encoding="utf-8") as inc_f:
                                inc_data = yaml.safe_load(inc_f) or {}
                                inc_runners = inc_data.get("runners", {})
                                if isinstance(inc_runners, dict):
                                    runners_dict.update(inc_runners)
                        except Exception as ie:
                            logger.warning("Failed to load included config %s: %s", inc_path, ie)
                    elif inc_path.is_dir():
                        for yaml_file in sorted(inc_path.glob("*.y*ml")):
                            watched[yaml_file] = yaml_file.stat().st_mtime
                            try:
                                with open(yaml_file, "r", encoding="utf-8") as yf:
                                    yf_data = yaml.safe_load(yf) or {}
                                    yf_runners = yf_data.get("runners", {})
                                    if isinstance(yf_runners, dict):
                                        runners_dict.update(yf_runners)
                            except Exception as ye:
                                logger.warning("Failed to load yaml from dir %s: %s", yaml_file, ye)

            new_runners: dict[str, BaseRunner] = {}

            for runner_id, runner_info in runners_dict.items():
                if not isinstance(runner_info, dict):
                    continue
                runner_type = runner_info.get("type")
                if not runner_type:
                    continue

                default_params = dict(runner_info.get("default_params", {}))
                prompt_file = default_params.get("system_prompt_file") or runner_info.get("system_prompt_file")
                if prompt_file:
                    prompt_path = Path(prompt_file)
                    if not prompt_path.is_absolute() and self.config_path:
                        prompt_path = self.config_path.parent / prompt_path
                    if prompt_path.exists() and prompt_path.is_file():
                        watched[prompt_path] = prompt_path.stat().st_mtime
                        try:
                            default_params["system_prompt"] = prompt_path.read_text(encoding="utf-8").strip()
                        except Exception as pe:
                            logger.warning("Could not read prompt file %s for runner %s: %s", prompt_path, runner_id, pe)
                    else:
                        logger.warning("Prompt file %s does not exist for runner %s", prompt_path, runner_id)

                config = RunnerConfig(
                    id=runner_id,
                    type=runner_type,
                    model=runner_info.get("model", runner_id),
                    api_key_env=runner_info.get("api_key_env"),
                    base_url=runner_info.get("base_url"),
                    cost_per_million_input_tokens=float(
                        runner_info.get("cost_per_million_input_tokens", 0.0)
                    ),
                    cost_per_million_output_tokens=float(
                        runner_info.get("cost_per_million_output_tokens", 0.0)
                    ),
                    default_params=default_params,
                    timeout_seconds=float(
                        runner_info.get(
                            "timeout_seconds",
                            self.server_config.get("default_timeout_seconds", 60.0),
                        )
                    ),
                )

                factory = self.RUNNER_FACTORIES.get(runner_type)
                if factory:
                    new_runners[runner_id] = factory(config)

            self._runners = new_runners
            self._watched_files = watched
            logger.info("Registry updated: loaded %d runners from %d files", len(self._runners), len(self._watched_files))
        except Exception as e:
            logger.error("Failed to reload configuration: %s", e)

    def reload_if_modified(self) -> None:
        """Check if config file or any included files/prompts have been modified and reload."""
        if not self._watched_files:
            if self.config_path and self.config_path.exists():
                self.reload()
            return

        try:
            for p, recorded_mtime in list(self._watched_files.items()):
                if not p.exists() or p.stat().st_mtime > recorded_mtime:
                    self.reload()
                    break
        except Exception:
            pass

    @classmethod
    def from_yaml(cls, config_path: str | Path | None = None) -> RunnerRegistry:
        """Create and populate registry from a YAML config file."""
        resolved_path = cls.find_config_path(config_path)
        registry = cls(config_path=resolved_path)
        registry.reload()
        return registry

    def get(self, runner_id: str) -> BaseRunner | None:
        """Get runner instance by ID with auto-reload and smart alias matching."""
        self.reload_if_modified()

        # 1. Exact match
        if runner_id in self._runners:
            return self._runners[runner_id]

        # 2. Check case-insensitive match
        for k, v in self._runners.items():
            if k.lower() == runner_id.lower():
                return v

        # 3. Check with/without provider prefix (e.g. 'claude-sonnet-4.5' vs 'openrouter-claude-sonnet-4.5')
        for prefix in ("openrouter-", "ollama-", "openai-", "anthropic-"):
            # If user passed 'claude-sonnet-4.5', check 'openrouter-claude-sonnet-4.5'
            prefixed = f"{prefix}{runner_id}"
            if prefixed in self._runners:
                return self._runners[prefixed]

            # If user passed 'openrouter-claude-sonnet-4.5', check 'claude-sonnet-4.5'
            if runner_id.startswith(prefix):
                unprefixed = runner_id[len(prefix):]
                if unprefixed in self._runners:
                    return self._runners[unprefixed]

        # 4. Check if user passed model name directly (e.g. 'anthropic/claude-sonnet-4.5')
        for runner in self._runners.values():
            if runner.model.lower() == runner_id.lower():
                return runner

        return None

    def list_runners(self) -> dict[str, BaseRunner]:
        """Return all registered runners dictionary."""
        self.reload_if_modified()
        return dict(self._runners)

    def registered_ids(self) -> list[str]:
        """Return list of registered runner IDs."""
        self.reload_if_modified()
        return list(self._runners.keys())

    def get_runners_metadata(self) -> list[dict[str, Any]]:
        """Return structured metadata for all registered runners."""
        self.reload_if_modified()
        metadata_list = []
        for runner_id, runner in self._runners.items():
            cfg = runner.config
            is_ready = True
            if cfg.api_key_env:
                is_ready = bool(os.environ.get(cfg.api_key_env))
            elif cfg.type in ("anthropic", "openai", "openrouter", "nvidia"):
                default_env = {
                    "anthropic": "ANTHROPIC_API_KEY",
                    "openai": "OPENAI_API_KEY",
                    "openrouter": "OPENROUTER_API_KEY",
                    "nvidia": "NVIDIA_API_KEY",
                }.get(cfg.type, "")
                is_ready = bool(os.environ.get(default_env))

            metadata_list.append({
                "runner_id": runner_id,
                "type": cfg.type,
                "model": cfg.model,
                "pricing": {
                    "cost_per_million_input_tokens": cfg.cost_per_million_input_tokens,
                    "cost_per_million_output_tokens": cfg.cost_per_million_output_tokens,
                },
                "timeout_seconds": cfg.timeout_seconds,
                "default_params": cfg.default_params,
                "credentials_env_var": cfg.api_key_env,
                "is_authenticated": is_ready,
                "base_url": cfg.base_url,
            })
        return metadata_list
