"""MCP Delegation Server entrypoint and tool registration."""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import sys
from typing import Any

from mcp.server import MCPServer

from mcp_delegation_server.benchmark.engine import BenchmarkEngine
from mcp_delegation_server.router import TaskRouter
from mcp_delegation_server.runners.base import RunnerResult
from mcp_delegation_server.runners.registry import RunnerRegistry


def _load_dotenv() -> None:
    """Auto-load variables from .env file in project root if present."""
    candidates = [
        Path.cwd() / ".env",
        Path(__file__).parent.parent / ".env",
    ]
    for env_file in candidates:
        if env_file.exists():
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip("'").strip('"')
                        if k and k not in os.environ:
                            os.environ[k] = v
            except Exception:
                pass
            break


_load_dotenv()

# Configure standard logger to stderr so stdio JSON-RPC remains clean
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("mcp_delegation_server")

# Initialize MCP server and Runner Registry
server = MCPServer(name="mcp-delegation-server")
_registry: RunnerRegistry | None = None
_engine: BenchmarkEngine | None = None
_router: TaskRouter | None = None


def get_registry(config_path: str | None = None) -> RunnerRegistry:
    """Lazy-initialize or get the RunnerRegistry instance with auto-reload."""
    global _registry
    if _registry is None:
        try:
            _registry = RunnerRegistry.from_yaml(config_path)
            logger.info("Loaded runners: %s", _registry.registered_ids())
        except Exception as e:
            logger.warning("Could not initialize registry on startup: %s", e)
            _registry = RunnerRegistry()
    else:
        _registry.reload_if_modified()
    return _registry


def get_engine() -> BenchmarkEngine:
    """Get the BenchmarkEngine instance."""
    global _engine
    reg = get_registry()
    if _engine is None or _engine.registry != reg:
        max_concurrency = reg.server_config.get("max_concurrency", 5)
        _engine = BenchmarkEngine(registry=reg, max_concurrency=max_concurrency)
    return _engine


def get_router() -> TaskRouter:
    """Get the TaskRouter instance."""
    global _router
    reg = get_registry()
    if _router is None or _router.registry != reg:
        _router = TaskRouter(registry=reg)
    return _router


def _sync_tool_enums() -> None:
    """Sync registered runner IDs into the JSON Schema enum for UI dropdown support."""
    try:
        registry = get_registry()
        registered_ids = ["auto", "nvidia", "ollama", "claude"] + registry.registered_ids()
        for tool_info in server._tool_manager.list_tools():
            props = tool_info.parameters.get("properties", {})
            if "runner_id" in props:
                props["runner_id"]["enum"] = registered_ids
                props["runner_id"]["description"] = (
                    "Select a specific runner or 'auto' for intelligent routing"
                )
            if "model" in props:
                props["model"]["enum"] = registered_ids
                props["model"]["description"] = (
                    "Target model, provider shortcut ('nvidia', 'ollama', 'claude'), or 'auto'"
                )
            if "judge_runner_id" in props:
                props["judge_runner_id"]["enum"] = registry.registered_ids()
            if "runner_ids" in props:
                items = props["runner_ids"].get("items", {})
                items["enum"] = registry.registered_ids()
    except Exception as e:
        logger.debug("Could not sync tool enums: %s", e)


_orig_list_tools = server.list_tools


async def _dynamic_list_tools():
    _sync_tool_enums()
    return await _orig_list_tools()


server.list_tools = _dynamic_list_tools


# =========================================================================
# MODEL SWITCHING & ACTIVE ROUTING TOOLS
# =========================================================================

@server.tool()
async def switch_model(
    model: str,
) -> str:
    """Switch the active model/sub-agent for all subsequent coding, review, and question tasks.
    
    Use this command anytime you want to switch backends (e.g. switch to free NVIDIA, switch to Claude, or switch back to auto).
    
    Args:
        model: Target model or provider shortcut. Options:
            - 'nvidia' or 'nemotron': Switches all tasks to NVIDIA NIM model (e.g. nemotron-3-super-120b-a12b).
            - 'claude' or 'sonnet': Switches to Claude Sonnet 4.5.
            - 'ollama' or 'local': Switches to local offline model (e.g. Qwen 2.5 Coder).
            - 'auto': Restores automatic intent-based routing (code review -> reviewer, plan -> planner).
            - 'direct': Instructs Claude Code to handle tasks natively without delegating.
            - Any specific runner_id (e.g. 'code-review-agent', 'planner-agent', 'gpt-4o').
            
    Returns:
        Confirmation message describing the newly active model and routing mode.
    """
    router = get_router()
    success, msg = router.set_active_runner(model)
    return msg


@server.tool()
async def get_active_model() -> str:
    """Get the currently active model and routing mode."""
    router = get_router()
    info = router.get_active_runner_info()
    return json.dumps(info, indent=2)


def _clean_review_output(output: str) -> str:
    """Extract strictly the review report and remove any model reasoning or scratchpad text."""
    markers = [
        "# 🛡️ Code Review Report",
        "# 🛡️",
        "## 📊 Summary of Findings",
        "## 🚨 Blockers",
        "## 🔴 High Priority Issues",
        "## 🔴 High Priority",
        "## 🟡 Medium Priority Issues",
        "## 🟡 Medium Priority",
        "## 💡 Suggestions & Minor Optimizations",
        "## 💡 Suggestions & Improvements",
        "## 💡 Suggestions",
        "✅ No issues found",
        "⚠️ This reviewer is scoped to Dart/Flutter",
    ]
    for marker in markers:
        idx = output.find(marker)
        if idx != -1:
            return output[idx:].strip()
    return output.strip()


# =========================================================================
# 1-CLICK DEDICATED TOOLS (Zero Configuration Needed!)
# =========================================================================

@server.tool()
async def create_plan(
    goal: str,
    context: str = "",
) -> str:
    """Create a structured, phased architectural implementation plan for any feature or project.
    
    Automatically routes to the specialized Planner Agent (Claude Sonnet 4.5) to design
    step-by-step execution phases, file-by-file changes, edge cases, and verification strategies.
    
    Args:
        goal: The feature, requirement, bug fix, or refactoring goal to plan.
        context: Optional background context, existing codebase details, or constraints.
        
    Returns:
        A comprehensive, phased technical implementation plan.
    """
    router = get_router()
    runner = router.route_task(f"Create an implementation plan for: {goal}")
    if runner is None:
        return json.dumps({"error": "No planner runner available. Check config.yaml"})

    task_prompt = f"Create a comprehensive, phased implementation plan for the following goal:\n\n**Goal**: {goal}"
    if context:
        task_prompt += f"\n\n**Context & Constraints**:\n{context}"

    result = await runner.execute(task=task_prompt)
    if result.success:
        return result.output
    return f"Plan creation failed: {result.error_message}"


@server.tool()
async def review_code(
    code: str,
    focus: str = "bugs, security, clean code, and performance",
) -> str:
    """Perform an in-depth, expert code review on any function, file, or code snippet.
    
    Automatically routes to the specialized Code Review sub-agent (NVIDIA Nemotron / Claude Sonnet)
    to check for edge cases, memory leaks, security vulnerabilities (OWASP), and provides refactored code.
    
    Args:
        code: The source code, diff, or function to review.
        focus: Optional review focus areas (e.g. 'security', 'performance', 'Flutter widget rebuilds').
        
    Returns:
        A structured code review report with critical issues, edge cases, and concrete refactored code.
    """
    router = get_router()
    runner = router.route_task(f"Review code with focus on {focus}")
    if runner is None:
        return json.dumps({"error": "No code review runner available. Check config.yaml"})

    task_prompt = (
        f"Perform a comprehensive code review focusing on: {focus}.\n\n"
        "Format the output strictly using the `# 🛡️ Code Review Report` template with Health Score, "
        "Summary Table, 🚨 Blockers, ⚠️ Warnings, 💡 Suggestions, ✅ Commendations, and 🛠️ Verification Commands.\n\n"
        "STRICT RULES:\n"
        "- Begin directly with `# 🛡️ Code Review Report`.\n"
        "- NEVER output or rewrite the entire source code file.\n"
        "- NEVER include internal thinking process, conversational greetings, or closing text.\n\n"
        f"```\n{code}\n```"
    )
    result = await runner.execute(task=task_prompt)
    if result.success:
        return _clean_review_output(result.output)
    return f"Code review failed: {result.error_message}"


@server.tool()
async def generate_tests(
    code: str,
    framework: str = "standard unit test framework (pytest, flutter_test, etc.)",
) -> str:
    """Generate production-ready unit and integration tests with 100% edge case coverage.
    
    Automatically routes to the specialized Test Generator sub-agent (NVIDIA Nemotron / GPT-4o)
    to produce complete, runnable tests with mocking, assertions, and edge case handling.
    
    Args:
        code: The source code or function that needs test coverage.
        framework: Optional testing framework (e.g. 'pytest', 'flutter_test', 'jest').
        
    Returns:
        Complete test suite code ready to be pasted or saved directly into test files.
    """
    router = get_router()
    runner = router.route_task("Generate unit tests for this code")
    if runner is None:
        return json.dumps({"error": "No test generator runner available. Check config.yaml"})

    task_prompt = f"Generate comprehensive unit and integration tests using {framework} for this code:\n\n```\n{code}\n```"
    result = await runner.execute(task=task_prompt)
    if result.success:
        return result.output
    return f"Test generation failed: {result.error_message}"


@server.tool()
async def ask_subagent(
    prompt: str,
    model: str = "auto",
) -> str:
    """Ask any programming or reasoning question directly to an external sub-agent model.
    
    Routes directly to the requested model without needing to switch session modes.
    
    Args:
        prompt: Your natural language question, instruction, or coding problem.
        model: Target model or provider. Options:
               - 'nvidia' / 'nemotron' (NVIDIA NIM 120B)
               - 'claude' / 'sonnet' (Claude Sonnet 4.5)
               - 'ollama' / 'local' (Local offline model, $0.00)
               - 'openai' / 'gpt-4o' (OpenAI GPT-4o)
               - 'auto' (Uses currently active/default runner)
               - Any specific runner ID from config.yaml
               
    Returns:
        The full output response generated by the requested model.
    """
    router = get_router()
    if model.lower() == "auto":
        runner = router.get_default_runner()
    else:
        runner = router.resolve_shortcut(model)

    if runner is None:
        all_runners = router.registry.list_runners()
        return json.dumps({
            "error": f"Model '{model}' not found in registry.",
            "available_runners": list(all_runners.keys()),
        })

    logger.info("ask_subagent: Routing prompt to '%s' (%s)", runner.id, runner.model)
    result = await runner.execute(task=prompt)
    if result.success:
        cost_str = f" | Cost: ${result.estimated_cost_usd:.6f}" if result.estimated_cost_usd > 0 else ""
        header = f"**[Sub-Agent: {runner.id} ({runner.model}) | Latency: {result.latency_ms:.0f}ms{cost_str}]**\n\n"
        return f"{header}{result.output}"
    return f"Execution error ({runner.id}): {result.error_message}"


def _read_file_from_disk(file_path: str) -> tuple[str | None, str | None]:
    """Read a file from disk, returning (content, error_message)."""
    try:
        target = Path(file_path).expanduser().resolve()
        if not target.exists():
            return None, f"❌ File not found: `{file_path}` (resolved to `{target}`)"
        if not target.is_file():
            return None, f"❌ Path is not a file: `{file_path}`"
        size_kb = target.stat().st_size / 1024
        if size_kb > 500:
            return None, (
                f"⚠️ File too large: `{file_path}` ({size_kb:.1f} KB). "
                "Max recommended: 500 KB (~125K tokens). Split into smaller files."
            )
        content = target.read_text(encoding="utf-8")
        return content, None
    except UnicodeDecodeError:
        return None, f"❌ Cannot read binary file: `{file_path}`. Only text/source files are supported."
    except PermissionError:
        return None, f"❌ Permission denied reading: `{file_path}`"
    except Exception as e:
        return None, f"❌ Error reading file: `{file_path}`: {type(e).__name__}: {e}"


@server.tool()
async def review_file(
    file_path: str,
    focus: str = "bugs, security, clean code, and performance",
) -> str:
    """Review a source code file directly from disk — TRUE zero Claude token burn.

    The MCP server reads the file itself and sends it to the Code Review sub-agent.
    Claude Code does NOT need to read or echo the file content at all.

    Args:
        file_path: Absolute or relative path to the source file to review (e.g. 'lib/screens/login.dart').
        focus: Optional review focus areas (e.g. 'security', 'performance', 'Flutter widget rebuilds').

    Returns:
        Structured code review with High/Medium/Suggestion findings.
    """
    code, error = _read_file_from_disk(file_path)
    if error:
        return error

    resolved_name = Path(file_path).name
    logger.info("review_file: Read %d chars from %s", len(code), resolved_name)

    router = get_router()
    runner = router.route_task(f"Review code with focus on {focus}")
    if runner is None:
        return json.dumps({"error": "No code review runner available. Check config.yaml"})

    task_prompt = (
        f"Perform a comprehensive code review of **`{resolved_name}`** focusing on: {focus}.\n\n"
        "Format the output strictly using the `# 🛡️ Code Review Report` template with Health Score, "
        "Summary Table, 🚨 Blockers, ⚠️ Warnings, 💡 Suggestions, ✅ Commendations, and 🛠️ Verification Commands.\n\n"
        "STRICT RULES:\n"
        "- Begin directly with `# 🛡️ Code Review Report`.\n"
        "- NEVER output or rewrite the entire source code file.\n"
        "- NEVER include internal thinking process, conversational greetings, or closing text.\n\n"
        f"```\n{code}\n```"
    )
    result = await runner.execute(task=task_prompt)
    if result.success:
        return _clean_review_output(result.output)
    return f"Code review failed: {result.error_message}"


@server.tool()
async def test_file(
    file_path: str,
    framework: str = "standard unit test framework (pytest, flutter_test, etc.)",
) -> str:
    """Generate tests for a source code file directly from disk — TRUE zero Claude token burn.

    The MCP server reads the file itself and sends it to the Test Generator sub-agent.
    Claude Code does NOT need to read or echo the file content at all.

    Args:
        file_path: Absolute or relative path to the source file to generate tests for.
        framework: Optional testing framework (e.g. 'pytest', 'flutter_test', 'jest').

    Returns:
        Complete test suite code ready to be used.
    """
    code, error = _read_file_from_disk(file_path)
    if error:
        return error

    resolved_name = Path(file_path).name
    logger.info("test_file: Read %d chars from %s", len(code), resolved_name)

    router = get_router()
    runner = router.route_task("Generate unit tests for this code")
    if runner is None:
        return json.dumps({"error": "No test generator runner available. Check config.yaml"})

    task_prompt = (
        f"Generate comprehensive unit and integration tests using {framework} "
        f"for the file **`{resolved_name}`**:\n\n```\n{code}\n```"
    )
    result = await runner.execute(task=task_prompt)
    if result.success:
        return result.output
    return f"Test generation failed: {result.error_message}"


@server.tool()
async def explain_code(
    code: str,
    audience: str = "mid-level engineer",
    language: str = "auto",
) -> str:
    """Get a clear, structured plain-English explanation of any code snippet or function.

    Routes to the specialized Explainer Agent (NVIDIA Nemotron) to produce a
    step-by-step walkthrough: purpose, inputs/outputs, logic flow, design patterns used,
    non-obvious behaviors, and suggested follow-up questions.

    Works with ANY language: Dart, Flutter, Python, TypeScript, Go, Rust, SQL, and more.

    Args:
        code: The source code, function, class, or snippet to explain.
        audience: Explanation depth level:
            - 'junior': Defines all patterns and framework concepts. More detailed.
            - 'mid-level' (default): Focuses on design decisions and non-obvious behaviors.
            - 'senior': Terse technical summary, architecture and tradeoffs only.
            - 'non-technical': Plain-English analogies, no code references.
        language: Optional language hint (e.g. 'dart', 'python', 'typescript'). Use 'auto' to detect.

    Returns:
        Structured explanation with Purpose, Inputs/Outputs, Logic Walkthrough,
        Key Patterns, Non-Obvious Behaviors, and Suggested Follow-up Questions.
    """
    router = get_router()
    runner = router.route_task("explain what does this code do")
    if runner is None:
        return '{"error": "No explainer runner available. Check config.yaml"}'

    lang_hint = f" (Language: {language})" if language.lower() != "auto" else ""
    task_prompt = (
        f"Explain the following code{lang_hint} for a {audience}.\n\n"
        "Format your response strictly using the `# 📖 Code Explanation:` template.\n\n"
        f"```\n{code}\n```"
    )
    result = await runner.execute(task=task_prompt)
    if result.success:
        return result.output
    return f"Code explanation failed: {result.error_message}"


@server.tool()
async def explain_file(
    file_path: str,
    audience: str = "mid-level engineer",
) -> str:
    """Get a plain-English explanation of a source file directly from disk — TRUE zero Claude token burn.

    The MCP server reads the file itself and sends it to the Explainer sub-agent.
    Claude Code does NOT need to read or echo the file content at all.

    Works with ANY language: Dart, Flutter, Python, TypeScript, Go, Rust, SQL, and more.

    Args:
        file_path: Absolute or relative path to the source file to explain
                   (e.g. 'lib/services/auth_service.dart', 'mcp_delegation_server/router.py').
        audience: Explanation depth level:
            - 'junior': Defines all patterns and framework concepts. More detailed.
            - 'mid-level' (default): Focuses on design decisions and non-obvious behaviors.
            - 'senior': Terse technical summary, architecture and tradeoffs only.
            - 'non-technical': Plain-English analogies, no code references.

    Returns:
        Structured explanation with Purpose, Inputs/Outputs, Logic Walkthrough,
        Key Patterns, Non-Obvious Behaviors, and Suggested Follow-up Questions.
    """
    code, error = _read_file_from_disk(file_path)
    if error:
        return error

    resolved_name = Path(file_path).name
    logger.info("explain_file: Read %d chars from %s", len(code), resolved_name)

    router = get_router()
    runner = router.route_task("explain what does this code do")
    if runner is None:
        return '{"error": "No explainer runner available. Check config.yaml"}'

    task_prompt = (
        f"Explain the file **`{resolved_name}`** for a {audience}.\n\n"
        "Format your response strictly using the `# 📖 Code Explanation:` template.\n\n"
        f"```\n{code}\n```"
    )
    result = await runner.execute(task=task_prompt)
    if result.success:
        return result.output
    return f"Code explanation failed: {result.error_message}"


# =========================================================================
# GENERAL DELEGATION & BENCHMARK TOOLS
# =========================================================================

@server.tool()
async def list_runners() -> str:
    """List all registered external LLM runners and specialized sub-agents.
    
    Returns:
        JSON list of runner metadata objects with pricing, authentication status, and default parameters.
    """
    registry = get_registry()
    metadata = registry.get_runners_metadata()
    return json.dumps(metadata, indent=2)


@server.tool()
async def delegate_task(
    task: str,
    runner_id: str = "auto",
    params: dict[str, Any] | None = None,
) -> str:
    """Delegate a task to an external runner (or use 'auto' for intelligent routing).
    
    Args:
        task: The natural language prompt, instruction, code, or query.
        runner_id: Specific runner ID, or 'auto' (default) to automatically pick the best agent.
        params: Optional dictionary of parameter overrides (max_tokens, temperature, system_prompt).
        
    Returns:
        JSON-formatted string representing normalized RunnerResult with output, latency, tokens, cost.
    """
    router = get_router()
    runner = router.route_task(task=task, explicit_runner_id=runner_id)

    if runner is None:
        available = router.registry.registered_ids()
        err_res = RunnerResult(
            runner_id=runner_id,
            model="unknown",
            task=task,
            output="",
            latency_ms=0.0,
            input_tokens=0,
            output_tokens=0,
            estimated_cost_usd=0.0,
            success=False,
            error_message=(
                f"Runner '{runner_id}' is not registered. Available runners: {available}. "
                "Use list_runners() to see all registered runners."
            ),
        )
        return err_res.to_json()

    try:
        result = await runner.execute(task=task, params=params)
        return result.to_json()
    except Exception as e:
        logger.exception("Unhandled error executing runner %s", runner.id)
        err_res = RunnerResult(
            runner_id=runner.id,
            model=runner.model,
            task=task,
            output="",
            latency_ms=0.0,
            input_tokens=0,
            output_tokens=0,
            estimated_cost_usd=0.0,
            success=False,
            error_message=f"Server execution error: {type(e).__name__}: {str(e)}",
        )
        return err_res.to_json()


@server.tool()
async def benchmark_run(
    task: str,
    runner_ids: list[str] | None = None,
    params: dict[str, Any] | None = None,
    reference_answer: str | None = None,
    judge_runner_id: str | None = None,
    eval_criteria: dict[str, Any] | None = None,
) -> str:
    """Fan out a task across multiple runners concurrently and produce a comparative benchmark report.
    
    Args:
        task: The natural language prompt or problem to execute.
        runner_ids: Optional list of runners. If omitted, all authenticated runners are evaluated.
        params: Optional inference parameters.
        reference_answer: Optional ground-truth answer for similarity scoring.
        judge_runner_id: Optional runner ID of an LLM to evaluate candidate answers.
        eval_criteria: Optional custom rubric settings.
        
    Returns:
        JSON report with winner ID, Markdown comparison table, and per-model scores.
    """
    registry = get_registry()
    engine = get_engine()

    target_runner_ids = runner_ids
    if not target_runner_ids:
        metadata = registry.get_runners_metadata()
        target_runner_ids = [r["runner_id"] for r in metadata if r.get("is_authenticated")]
        if not target_runner_ids:
            target_runner_ids = registry.registered_ids()

    benchmark_result = await engine.run_benchmark(
        task=task,
        runner_ids=target_runner_ids,
        params=params,
        eval_criteria=eval_criteria,
        reference_answer=reference_answer,
        judge_runner_id=judge_runner_id,
    )

    return benchmark_result.to_json()


def main() -> None:
    """CLI entrypoint for running the MCP server."""
    parser = argparse.ArgumentParser(description="MCP Tool-Delegation & Benchmark Server")
    parser.add_argument(
        "--config",
        "-c",
        type=str,
        default=None,
        help="Path to config.yaml (defaults to MCP_CONFIG_PATH or current directory)",
    )
    parser.add_argument(
        "--transport",
        "-t",
        type=str,
        default="stdio",
        choices=["stdio", "sse", "streamable-http"],
        help="Transport protocol to use (default: stdio)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host for HTTP/SSE transport (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port for HTTP/SSE transport (default: 8000)",
    )

    args = parser.parse_args()

    # Preload configuration
    get_registry(args.config)
    _sync_tool_enums()

    logger.info("Starting MCP server with transport: %s", args.transport)
    if args.transport == "stdio":
        server.run(transport="stdio")
    elif args.transport == "sse":
        server.run(transport="sse", host=args.host, port=args.port)
    elif args.transport == "streamable-http":
        server.run(transport="streamable-http", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
