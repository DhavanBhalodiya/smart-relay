"""Tests for TaskRouter and 1-click convenience tools."""

from __future__ import annotations

import pytest

from mcp_delegation_server.router import TaskRouter
from mcp_delegation_server.runners.registry import RunnerRegistry
from mcp_delegation_server.server import ask_subagent, generate_tests, review_code, server


def test_task_router_intent_detection():
    """Verify router automatically selects appropriate agents based on task prompt."""
    registry = RunnerRegistry.from_yaml()
    router = TaskRouter(registry=registry)

    # 1. Code review intent
    r_review = router.route_task("Please review this Python function for security vulnerabilities and race conditions.")
    assert r_review is not None
    assert r_review.id == "code-review-agent"

    # 2. Test generation intent
    r_test = router.route_task("Generate comprehensive pytest unit tests for authentication service.")
    assert r_test is not None
    assert r_test.id in ("test-generator-agent", "gpt-4o")

    # 3. Explicit runner ID override
    r_explicit = router.route_task("Write a poem", explicit_runner_id="claude-3-7-sonnet")
    assert r_explicit is not None
    assert r_explicit.id == "claude-3-7-sonnet"


@pytest.mark.asyncio
async def test_tools_registered_with_server():
    """Verify that easy 1-click tools are registered with MCPServer."""
    tools = server._tool_manager.list_tools()
    tool_names = [t.name for t in tools]

    assert "switch_model" in tool_names
    assert "get_active_model" in tool_names
    assert "create_plan" in tool_names
    assert "review_code" in tool_names
    assert "generate_tests" in tool_names
    assert "ask_subagent" in tool_names
    assert "delegate_task" in tool_names
    assert "benchmark_run" in tool_names


def test_switch_model_router_state():
    """Test TaskRouter dynamic model switching."""
    registry = RunnerRegistry.from_yaml()
    router = TaskRouter(registry=registry)

    # 1. Switch to nvidia
    ok, msg = router.set_active_runner("nvidia")
    assert ok is True
    assert "nemotron-3-super-120b-a12b" in msg
    assert router.route_task("General question").id in ("nemotron-3-super-120b-a12b", "nvidia-llama-70b")

    # 2. Switch to auto
    ok, msg = router.set_active_runner("auto")
    assert ok is True
    assert router.active_runner_id is None


def test_router_shortcut_resolution():
    """Test TaskRouter direct shortcut resolution without mode switching."""
    registry = RunnerRegistry.from_yaml()
    router = TaskRouter(registry=registry)

    # Shortcut 'nvidia'
    r_nv = router.route_task("Hello", explicit_runner_id="nvidia")
    assert r_nv is not None
    assert r_nv.id in ("nemotron-3-super-120b-a12b", "nvidia-llama-70b")

    # Shortcut 'ollama' / 'local'
    r_ol = router.route_task("Hello", explicit_runner_id="ollama")
    assert r_ol is not None
    assert r_ol.id in ("ollama-qwen-coder", "ollama-llama3.2")

    # Shortcut 'claude'
    r_cl = router.route_task("Hello", explicit_runner_id="claude")
    assert r_cl is not None
    assert r_cl.id in ("openrouter-claude-sonnet-4.5", "code-review-agent", "claude-3-7-sonnet")




def test_read_file_from_disk_success(tmp_path):
    """Test _read_file_from_disk reads a valid file."""
    from mcp_delegation_server.server import _read_file_from_disk

    test_file = tmp_path / "hello.dart"
    test_file.write_text("void main() {}", encoding="utf-8")

    content, error = _read_file_from_disk(str(test_file))
    assert error is None
    assert content == "void main() {}"


def test_read_file_from_disk_not_found():
    """Test _read_file_from_disk returns error for missing file."""
    from mcp_delegation_server.server import _read_file_from_disk

    content, error = _read_file_from_disk("/nonexistent/path/fake.dart")
    assert content is None
    assert "File not found" in error


def test_read_file_from_disk_too_large(tmp_path):
    """Test _read_file_from_disk rejects files over 500KB."""
    from mcp_delegation_server.server import _read_file_from_disk

    big_file = tmp_path / "huge.dart"
    big_file.write_text("x" * (600 * 1024), encoding="utf-8")  # 600 KB

    content, error = _read_file_from_disk(str(big_file))
    assert content is None
    assert "too large" in error


def test_read_file_from_disk_directory(tmp_path):
    """Test _read_file_from_disk rejects directories."""
    from mcp_delegation_server.server import _read_file_from_disk

    content, error = _read_file_from_disk(str(tmp_path))
    assert content is None
    assert "not a file" in error


def test_review_file_and_test_file_tools_registered():
    """Verify review_file and test_file are registered MCP tools."""
    from mcp_delegation_server.server import server

    tool_names = [t.name for t in server._tool_manager.list_tools()]
    assert "review_file" in tool_names, f"review_file not found in {tool_names}"
    assert "test_file" in tool_names, f"test_file not found in {tool_names}"


def test_system_prompt_file_loading():
    """Verify system_prompt_file correctly loads external markdown prompt files into runner config."""
    from mcp_delegation_server.runners.registry import RunnerRegistry

    registry = RunnerRegistry.from_yaml()
    reviewer = registry.get("code-review-agent")
    assert reviewer is not None
    assert "Resource Cleanup & Memory" in reviewer.config.default_params.get("system_prompt", "")
    assert "Principal Code Reviewer" in reviewer.config.default_params.get("system_prompt", "")

    planner = registry.get("planner-agent")
    assert planner is not None
    assert "Principal Software Architect" in planner.config.default_params.get("system_prompt", "")


def test_modular_includes_loading():
    """Verify registry loads all runners across modular included YAML files."""
    from mcp_delegation_server.runners.registry import RunnerRegistry

    registry = RunnerRegistry.from_yaml()
    ids = registry.registered_ids()

    # From agents.yaml
    assert "planner-agent" in ids
    assert "code-review-agent" in ids
    assert "test-generator-agent" in ids

    # From nvidia.yaml
    assert "nemotron-3-super-120b-a12b" in ids
    assert "nvidia-qwen-coder" in ids

    # From openrouter.yaml
    assert "openrouter-claude-sonnet-4.5" in ids
    assert "openrouter-deepseek-v3" in ids

    # From ollama.yaml
    assert "ollama-qwen-coder" in ids

    # From anthropic.yaml
    assert "claude-3-7-sonnet" in ids

    # From openai.yaml
    assert "gpt-4o" in ids


def test_clean_review_output():
    """Verify _clean_review_output strips preamble/scratchpad and extracts markdown sections."""
    from mcp_delegation_server.server import _clean_review_output

    raw_output = """
We are given a Dart/Flutter code snippet.
Let's break down the code:
1. Controller not disposed...

# 🛡️ Code Review Report
**Scope**: `lib/login.dart`
**Overall Health Score**: 72/100 (C)

## 📊 Summary of Findings
| Severity | Count | Status |
| :--- | :--- | :--- |
| 🚨 **Blockers** | 1 | Needs immediate fix |

## 🚨 Blockers (Must Fix)
- `[L12]`: `_controller` is never disposed.
  ```diff
  + void dispose() { _controller.dispose(); super.dispose(); }
  ```
"""
    cleaned = _clean_review_output(raw_output)
    assert not cleaned.startswith("We are given")
    assert cleaned.startswith("# 🛡️ Code Review Report")
    assert "## 📊 Summary of Findings" in cleaned
    assert "## 🚨 Blockers (Must Fix)" in cleaned

