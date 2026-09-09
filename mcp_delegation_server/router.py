"""Intelligent router for auto-selecting the best runner based on task intent or explicit model shortcuts."""

from __future__ import annotations

import re
from typing import Any

from mcp_delegation_server.runners.base import BaseRunner
from mcp_delegation_server.runners.registry import RunnerRegistry


class TaskRouter:
    """Routes tasks to the most suitable runner automatically, via shortcuts, or explicit IDs."""

    def __init__(self, registry: RunnerRegistry) -> None:
        self.registry = registry
        self.active_runner_id: str | None = None

    def resolve_shortcut(self, target: str) -> BaseRunner | None:
        """Resolve a shortcut or provider name (e.g. 'nvidia', 'ollama', 'claude') to a runner."""
        target_clean = target.strip().lower()

        # 1. Exact match in registry
        runner = self.registry.get(target)
        if runner:
            return runner

        # 2. Provider & Model Shortcuts
        if "nvidia" in target_clean or "nemotron" in target_clean:
            for rid in ["nemotron-3-super-120b-a12b", "nvidia-llama-70b", "nvidia-qwen-coder", "nvidia-deepseek-r1"]:
                runner = self.registry.get(rid)
                if runner:
                    return runner

        if "ollama" in target_clean or "local" in target_clean or "free" in target_clean:
            for rid in ["ollama-qwen-coder", "ollama-llama3.2", "ollama-deepseek-r1", "openrouter-qwen-coder-free"]:
                runner = self.registry.get(rid)
                if runner:
                    return runner

        if "claude" in target_clean or "sonnet" in target_clean:
            for rid in ["openrouter-claude-sonnet-4.5", "code-review-agent", "claude-3-7-sonnet"]:
                runner = self.registry.get(rid)
                if runner:
                    return runner

        if "openai" in target_clean or "gpt" in target_clean:
            for rid in ["gpt-4o", "gpt-4o-mini", "test-generator-agent"]:
                runner = self.registry.get(rid)
                if runner:
                    return runner

        if "plan" in target_clean:
            runner = self.registry.get("planner-agent")
            if runner:
                return runner

        if "review" in target_clean:
            runner = self.registry.get("code-review-agent")
            if runner:
                return runner

        if "test" in target_clean:
            runner = self.registry.get("test-generator-agent")
            if runner:
                return runner

        if "explain" in target_clean:
            runner = self.registry.get("explain-agent")
            if runner:
                return runner

        return None

    def set_active_runner(self, target: str) -> tuple[bool, str]:
        """Switch active runner. Target can be an exact runner_id, provider name, or 'auto'."""
        target_clean = target.strip().lower()

        if target_clean in ("auto", "default", "reset"):
            self.active_runner_id = None
            return True, "Switched to 'auto' mode. TaskRouter will automatically pick the best agent for each task."

        if target_clean in ("direct", "claude-direct", "native"):
            self.active_runner_id = "direct"
            return True, "Switched to 'direct' mode. Claude Code will handle tasks natively."

        runner = self.resolve_shortcut(target)
        if runner:
            self.active_runner_id = runner.id
            return True, f"Active model switched to: '{runner.id}' ({runner.model})"

        available = self.registry.registered_ids()
        return False, f"Could not find runner matching '{target}'. Available runners: {available}"

    def get_active_runner_info(self) -> dict[str, Any]:
        """Return information about the currently active runner and mode."""
        if self.active_runner_id is None:
            default_r = self.get_default_runner()
            return {
                "mode": "auto",
                "active_runner_id": default_r.id if default_r else None,
                "model": default_r.model if default_r else None,
                "description": "Auto-routing active based on task keywords",
            }
        
        runner = self.registry.get(self.active_runner_id)
        return {
            "mode": "pinned",
            "active_runner_id": self.active_runner_id,
            "model": runner.model if runner else "unknown",
            "description": f"Pinned to {self.active_runner_id}",
        }

    def get_default_runner(self) -> BaseRunner | None:
        """Get the primary default runner configured in server or first available."""
        server_cfg = self.registry.server_config
        default_id = server_cfg.get("default_runner")
        if default_id:
            runner = self.registry.get(default_id)
            if runner:
                return runner

        # Preferred defaults order
        preferred = [
            "nemotron-3-super-120b-a12b",
            "openrouter-claude-sonnet-4.5",
            "code-review-agent",
            "claude-3-7-sonnet",
            "gpt-4o",
            "gpt-4o-mini",
            "ollama-qwen-coder",
        ]
        for pid in preferred:
            runner = self.registry.get(pid)
            if runner:
                return runner

        # Fallback to first available runner
        all_runners = self.registry.list_runners()
        if all_runners:
            return next(iter(all_runners.values()))
        return None

    def route_task(self, task: str, explicit_runner_id: str | None = None) -> BaseRunner | None:
        """Pick the best runner for a task based on explicit ID/shortcut, active runner, or intent classification."""
        # 1. Explicit runner ID or shortcut provided in request
        if explicit_runner_id and explicit_runner_id not in ("default", "auto", ""):
            runner = self.resolve_shortcut(explicit_runner_id)
            if runner:
                return runner
            return self.registry.get(explicit_runner_id)

        # 2. Pinned active runner
        if self.active_runner_id and self.active_runner_id not in ("auto", "direct"):
            pinned_runner = self.registry.get(self.active_runner_id)
            if pinned_runner:
                return pinned_runner

        task_lower = task.lower()

        # 3. Planning / Architecture intent -> planner-agent
        plan_keywords = [
            "plan", "roadmap", "architecture", "break down", "design plan",
            "implementation plan", "strategy", "phases", "step-by-step plan"
        ]
        if any(kw in task_lower for kw in plan_keywords):
            runner = self.registry.get("planner-agent")
            if runner:
                return runner

        # 4. Code Review intent -> code-review-agent
        review_keywords = [
            "review", "audit", "critique", "vulnerability", "security",
            "edge case", "smell", "refactor", "race condition", "memory leak",
            "optimize", "performance issue", "bug in", "check this code"
        ]
        if any(kw in task_lower for kw in review_keywords):
            runner = self.registry.get("code-review-agent")
            if runner:
                return runner

        # 5. Explanation / Documentation intent -> explain-agent
        explain_keywords = [
            "explain", "what does this do", "how does this work",
            "walk me through", "help me understand", "document this",
            "what is this", "describe this", "break down", "annotate",
            "summarize this code", "help me read", "what does it do",
        ]
        if any(kw in task_lower for kw in explain_keywords):
            runner = self.registry.get("explain-agent")
            if runner:
                return runner

        # 6. Test Generation intent -> test-generator-agent
        test_keywords = [
            "generate test", "unit test", "widget test", "integration test",
            "pytest", "mock", "assert", "coverage", "test case", "tdd",
            "write test", "add test",
        ]
        if any(kw in task_lower for kw in test_keywords):
            runner = self.registry.get("test-generator-agent") or self.registry.get("gpt-4o")
            if runner:
                return runner

        # 7. Default primary runner
        return self.get_default_runner()
