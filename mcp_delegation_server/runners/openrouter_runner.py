"""OpenRouter API runner implementation."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import openai

from mcp_delegation_server.runners.base import BaseRunner, RunnerConfig, RunnerResult


class OpenRouterRunner(BaseRunner):
    """Runner adapter for models accessed via OpenRouter API gateway."""

    DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"

    def __init__(self, config: RunnerConfig) -> None:
        super().__init__(config)
        self._client: openai.AsyncOpenAI | None = None

    def _get_api_key(self) -> str | None:
        """Resolve API key strictly from environment variables."""
        env_var_name = self.config.api_key_env or "OPENROUTER_API_KEY"
        return os.environ.get(env_var_name)

    def _get_client(self, api_key: str) -> openai.AsyncOpenAI:
        """Get or initialize AsyncOpenAI client configured for OpenRouter."""
        base_url = self.config.base_url or self.DEFAULT_BASE_URL
        if self._client is None or self._client.api_key != api_key:
            self._client = openai.AsyncOpenAI(
                api_key=api_key,
                base_url=base_url,
                default_headers={
                    "HTTP-Referer": "https://github.com/mcp-delegation-server",
                    "X-Title": "MCP Delegation Server",
                },
            )
        return self._client

    async def execute(
        self, task: str, params: dict[str, Any] | None = None
    ) -> RunnerResult:
        """Execute a prompt/task using OpenRouter API and return normalized RunnerResult."""
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
        env_var_name = self.config.api_key_env or "OPENROUTER_API_KEY"

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

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": task})

            create_kwargs: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }

            response = await asyncio.wait_for(
                client.chat.completions.create(**create_kwargs),
                timeout=timeout,
            )

            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

            choice = response.choices[0] if response.choices else None
            output_text = choice.message.content or "" if choice else ""

            # Token usage
            input_tokens = response.usage.prompt_tokens if response.usage else 0
            output_tokens = response.usage.completion_tokens if response.usage else 0
            estimated_cost = self.calculate_cost(input_tokens, output_tokens)

            raw_metadata = {
                "finish_reason": choice.finish_reason if choice else None,
                "usage": {
                    "prompt_tokens": input_tokens,
                    "completion_tokens": output_tokens,
                    "total_tokens": response.usage.total_tokens if response.usage else 0,
                },
                "system_fingerprint": getattr(response, "system_fingerprint", None),
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
                error_message=f"Request to OpenRouter timed out after {timeout} seconds.",
            )

        except openai.AuthenticationError as e:
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
                error_message=f"OpenRouter authentication failed: {e.message}",
            )

        except openai.RateLimitError as e:
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
                error_message=f"OpenRouter rate limit exceeded: {e.message}",
            )

        except openai.APIStatusError as e:
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
                error_message=f"OpenRouter API error ({e.status_code}): {e.message}",
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
                error_message=f"Unexpected error executing OpenRouter runner: {type(e).__name__}: {str(e)}",
            )
