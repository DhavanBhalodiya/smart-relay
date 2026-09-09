"""Ollama local HTTP runner implementation."""

from __future__ import annotations

import time
from typing import Any

import httpx

from mcp_delegation_server.runners.base import BaseRunner, RunnerConfig, RunnerResult


class OllamaRunner(BaseRunner):
    """Runner adapter for local LLMs running via Ollama (e.g. Llama 3, DeepSeek, Mistral, Qwen)."""

    def __init__(self, config: RunnerConfig) -> None:
        super().__init__(config)
        self.base_url = (config.base_url or "http://localhost:11434").rstrip("/")

    async def execute(
        self, task: str, params: dict[str, Any] | None = None
    ) -> RunnerResult:
        """Execute a prompt/task against a local Ollama server via HTTP REST API."""
        start_time = time.perf_counter()

        # Merge default params with request params
        merged_params = dict(self.config.default_params)
        if params:
            merged_params.update(params)

        max_tokens = merged_params.get("max_tokens", 2048)
        temperature = merged_params.get("temperature", 0.7)
        system_prompt = merged_params.get("system_prompt")
        timeout = merged_params.get("timeout_seconds", self.config.timeout_seconds)

        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": task,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        if system_prompt:
            payload["system"] = system_prompt

        endpoint = f"{self.base_url}/api/generate"

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(endpoint, json=payload)

            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

            if response.status_code != 200:
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
                    error_message=f"Ollama returned HTTP error ({response.status_code}): {response.text}",
                )

            data = response.json()
            output_text = data.get("response", "")
            input_tokens = int(data.get("prompt_eval_count", 0))
            output_tokens = int(data.get("eval_count", 0))

            # Local models incur 0.0 USD unless configured with custom pricing
            estimated_cost = self.calculate_cost(input_tokens, output_tokens)

            raw_metadata = {
                "total_duration_ns": data.get("total_duration"),
                "load_duration_ns": data.get("load_duration"),
                "prompt_eval_duration_ns": data.get("prompt_eval_duration"),
                "eval_duration_ns": data.get("eval_duration"),
                "context": data.get("context"),
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

        except httpx.ConnectError:
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
                    f"Could not connect to Ollama server at '{self.base_url}'. "
                    "Ensure Ollama is installed and running ('ollama serve')."
                ),
            )

        except httpx.TimeoutException:
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
                error_message=f"Request to Ollama timed out after {timeout} seconds.",
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
                error_message=f"Unexpected error communicating with Ollama: {type(e).__name__}: {str(e)}",
            )
