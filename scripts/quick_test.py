"""Quick manual test script for executing delegation and benchmark tools locally."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import sys

from mcp_delegation_server.server import benchmark_run, delegate_task, get_registry, list_runners


def _load_dotenv() -> None:
    """Auto-load variables from .env file if present."""
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


async def main() -> None:
    parser = argparse.ArgumentParser(description="Quick manual tester for MCP Delegation Server")
    parser.add_argument(
        "task",
        type=str,
        nargs="?",
        default="Explain why the sky is blue in 2 concise bullet points.",
        help="Prompt/task to delegate or benchmark",
    )
    parser.add_argument(
        "--runner",
        "-r",
        type=str,
        default="openrouter-claude-sonnet-4.5",
        help="Runner ID for single delegation (e.g. code-review-agent, openrouter-claude-sonnet-4.5, gpt-4o)",
    )
    parser.add_argument(
        "--benchmark",
        "-b",
        action="store_true",
        help="Run concurrent benchmark across multiple runners",
    )
    parser.add_argument(
        "--runners",
        type=str,
        default="openrouter-claude-sonnet-4.5,code-review-agent",
        help="Comma-separated list of runner IDs to benchmark",
    )
    parser.add_argument(
        "--judge",
        type=str,
        default=None,
        help="Optional runner ID to act as LLM judge (e.g. openrouter-claude-sonnet-4.5)",
    )
    parser.add_argument(
        "--ref",
        type=str,
        default=None,
        help="Optional reference ground-truth answer for comparison",
    )
    parser.add_argument(
        "--list",
        "-l",
        action="store_true",
        help="List all registered runners with pricing and auth status",
    )
    parser.add_argument(
        "--config",
        "-c",
        type=str,
        default="config.yaml",
        help="Path to config.yaml",
    )
    args = parser.parse_args()

    registry = get_registry(args.config)

    if args.list:
        print("=== Registered LLM Runners & Agents ===")
        raw_list = await list_runners()
        runners = json.loads(raw_list)
        for r in runners:
            status = "AUTHENTICATED / READY" if r["is_authenticated"] else f"MISSING ({r.get('credentials_env_var')})"
            print(f"[{r['runner_id']}]")
            print(f"  Type: {r['type']} | Model: {r['model']}")
            print(f"  Pricing: ${r['pricing']['cost_per_million_input_tokens']:.2f}/M in, ${r['pricing']['cost_per_million_output_tokens']:.2f}/M out")
            print(f"  Status: {status}\n")
        return

    if args.benchmark:
        runner_list = [r.strip() for r in args.runners.split(",") if r.strip()]
        print(f"============================================================")
        print(f"🚀 MCP Benchmark Run (Concurrent Fan-out)")
        print(f"Task: {args.task}")
        print(f"Runners: {runner_list}")
        if args.judge:
            print(f"LLM Judge: {args.judge}")
        if args.ref:
            print(f"Reference Answer: {args.ref}")
        print(f"============================================================\n")

        print("Executing benchmark_run...")
        raw_bench = await benchmark_run(
            task=args.task,
            runner_ids=runner_list,
            reference_answer=args.ref,
            judge_runner_id=args.judge,
        )
        parsed = json.loads(raw_bench)

        print("\n--- Benchmark Comparison Table ---")
        print(parsed.get("comparison_table_markdown", ""))
        print(f"\n🏆 Winner: {parsed.get('winner_runner_id')}")
        print(f"⏱️ Total Duration: {parsed.get('total_duration_ms')} ms")
        print(f"Evaluated: {parsed.get('runners_evaluated')} runners ({parsed.get('successful_runs')} succeeded, {parsed.get('failed_runs')} failed)\n")

        print("--- Individual Outputs ---")
        for s in parsed.get("summaries", []):
            print(f"\n[{s['runner_id']} - {s['model']}]")
            if s["success"]:
                print(s["full_output"])
            else:
                print(f"FAILED: {s['error_message']}")
        return

    # Single delegation
    print(f"============================================================")
    print(f"MCP Delegation Test: runner='{args.runner}'")
    print(f"Task: {args.task}")
    print(f"============================================================\n")

    print("Executing delegate_task...")
    raw_result = await delegate_task(task=args.task, runner_id=args.runner)
    parsed = json.loads(raw_result)

    print("\n--- Execution Result ---")
    print(f"Success: {parsed.get('success')}")
    print(f"Model: {parsed.get('model')}")
    print(f"Latency: {parsed.get('latency_ms')} ms")
    print(f"Tokens: {parsed.get('input_tokens')} in / {parsed.get('output_tokens')} out")
    print(f"Cost: ${parsed.get('estimated_cost_usd'):.6f}")

    if parsed.get("success"):
        print(f"\nResponse:\n{parsed.get('output')}")
    else:
        print(f"\nError Details:\n{parsed.get('error_message')}")


if __name__ == "__main__":
    asyncio.run(main())
