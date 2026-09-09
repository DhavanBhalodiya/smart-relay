"""Anthropic API runner implementation."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import anthropic

from mcp_delegation_server.runners.base import BaseRunner, RunnerConfig, RunnerResult


class AnthropicRunner(BaseRunner):
    """Runner adapter for Anthropic Claude models via official SDK."""

    def __init__(self, config: RunnerConfig) -> None:
        super().__init__(config)
        self._client: anthropic.AsyncAnthropic | None = None

    def _get_api_key(self) -> str | None:
        """Resolve API key strictly from environment variables."""
        env_var_name = self.config.api_key_env or "ANTHROPIC_API_KEY"
        return os.environ.get(env_var_name)

    def _get_client(self, api_key: str) -> anthropic.AsyncAnthropic:
        """Get or initialize AsyncAnthropic client."""
        if self._client is None or self._client.api_key != api_key:
            self._client = anthropic.AsyncAnthropic(
                api_key=api_key,
                base_url=self.config.base_url or None,
            )
        return self._client

    async def execute(
        self, task: str, params: dict[str, Any] | None = None
    ) -> RunnerResult:
        """Execute a prompt/task using Anthropic API and return normalized RunnerResult."""
        start_time = time.perf_counter()
        
        # Merge default params with request params
        merged_params = dict(self.config.default_params)
        if params:
            merged_params.update(params)

        max_tokens = merged_params.get("max_tokens", 2048)
        temperature = merged_params.get("temperature", 0.7)
        system_prompt = merged_params.get("system_prompt")
        timeout = merged_params.get("timeout_seconds", self.config.timeout_seconds)

        api_key = self._get_api_key()
        env_var_name = self.config.api_key_env or "ANTHROPIC_API_KEY"

        if not api_key:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return RunnerResult(
                runner_id=self.id,
                model=self.model,
                task=task,
                output="",
                latency_ms=elapsed_ms,
                input_tokens=0,
                output_tokens=0,
                estimated_cost_usd=0.0,
                success=False,
                error_message=(
                    f"Authentication error: Environment variable '{env_var_name}' is not set. "
                    f"Please export {env_var_name}=<your-key> to use runner '{self.id}'."
                ),
            )

        try:
            client = self._get_client(api_key)

            messages = [{"role": "user", "content": task}]
            create_kwargs: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            if system_prompt:
                create_kwargs["system"] = system_prompt

            response = await asyncio.wait_for(
                client.messages.create(**create_kwargs),
                timeout=timeout,
            )

            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

            # Extract generated content
            output_chunks = []
            for block in response.content:
                if getattr(block, "type", None) == "text":
                    output_chunks.append(block.text)
                elif hasattr(block, "text"):
                    output_chunks.append(str(block.text))
            output_text = "".join(output_chunks)

            # Token usage
            input_tokens = response.usage.input_tokens if response.usage else 0
            output_tokens = response.usage.output_tokens if response.usage else 0
            estimated_cost = self.calculate_cost(input_tokens, output_tokens)

            raw_metadata = {
                "stop_reason": response.stop_reason,
                "stop_sequence": response.stop_sequence,
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_creation_input_tokens": getattr(response.usage, "cache_creation_input_tokens", 0),
                    "cache_read_input_tokens": getattr(response.usage, "cache_read_input_tokens", 0),
                },
            }

            return RunnerResult(
                runner_id=self.id,
                model=self.model,
                task=task,
                output=output_text,
                latency_ms=elapsed_ms,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                estimated_cost_usd=estimated_cost,
                success=True,
                error_message=None,
                raw_metadata=raw_metadata,
            )

        except asyncio.TimeoutError:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return RunnerResult(
                runner_id=self.id,
                model=self.model,
                task=task,
                output="",
                latency_ms=elapsed_ms,
                input_tokens=0,
                output_tokens=0,
                estimated_cost_usd=0.0,
                success=False,
                error_message=f"Request timed out after {timeout} seconds.",
            )

        except anthropic.AuthenticationError as e:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return RunnerResult(
                runner_id=self.id,
                model=self.model,
                task=task,
                output="",
                latency_ms=elapsed_ms,
                input_tokens=0,
                output_tokens=0,
                estimated_cost_usd=0.0,
                success=False,
                error_message=f"Anthropic authentication failed: {e.message}",
            )

        except anthropic.RateLimitError as e:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return RunnerResult(
                runner_id=self.id,
                model=self.model,
                task=task,
                output="",
                latency_ms=elapsed_ms,
                input_tokens=0,
                output_tokens=0,
                estimated_cost_usd=0.0,
                success=False,
                error_message=f"Anthropic rate limit exceeded: {e.message}",
            )

        except anthropic.APIStatusError as e:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return RunnerResult(
                runner_id=self.id,
                model=self.model,
                task=task,
                output="",
                latency_ms=elapsed_ms,
                input_tokens=0,
                output_tokens=0,
                estimated_cost_usd=0.0,
                success=False,
                error_message=f"Anthropic API error ({e.status_code}): {e.message}",
            )

        except Exception as e:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return RunnerResult(
                runner_id=self.id,
                model=self.model,
                task=task,
                output="",
                latency_ms=elapsed_ms,
                input_tokens=0,
                output_tokens=0,
                estimated_cost_usd=0.0,
                success=False,
                error_message=f"Unexpected error executing Anthropic runner: {type(e).__name__}: {str(e)}",
            )
