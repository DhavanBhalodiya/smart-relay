"""End-to-end stdio client test for MCP Delegation Server."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


@pytest.mark.asyncio
async def test_mcp_server_stdio_end_to_end():
    """Verify that the MCP server runs over stdio, advertises tools, and handles delegate_task, list_runners, and benchmark_run."""
    python_exe = sys.executable
    server_module = "mcp_delegation_server.server"
    root_dir = str(Path(__file__).parent.parent)

    server_params = StdioServerParameters(
        command=python_exe,
        args=["-m", server_module],
        env=dict(os.environ),
        cwd=root_dir,
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # Initialize session
            init_result = await session.initialize()
            assert init_result is not None

            # List tools
            tools_result = await session.list_tools()
            tool_names = [t.name for t in tools_result.tools]
            assert "delegate_task" in tool_names
            assert "list_runners" in tool_names
            assert "benchmark_run" in tool_names
            assert "switch_model" in tool_names
            assert "create_plan" in tool_names
            assert "review_code" in tool_names

            # Call switch_model tool
            switch_res = await session.call_tool("switch_model", arguments={"model": "nvidia"})
            assert len(switch_res.content) > 0
            assert "nemotron-3-super-120b-a12b" in switch_res.content[0].text.lower()

            # Call list_runners
            list_res = await session.call_tool("list_runners", arguments={})
            assert len(list_res.content) > 0
            runners_data = json.loads(list_res.content[0].text)
            assert isinstance(runners_data, list)
            assert any(r["runner_id"] == "claude-3-7-sonnet" for r in runners_data)
            assert any(r["runner_id"] == "nemotron-3-super-120b-a12b" for r in runners_data)

            # Call benchmark_run
            bench_res = await session.call_tool(
                "benchmark_run",
                arguments={
                    "task": "Explain quicksort in 1 sentence.",
                    "runner_ids": ["claude-3-7-sonnet", "gpt-4o"],
                },
            )
            assert len(bench_res.content) > 0
            parsed_bench = json.loads(bench_res.content[0].text)
            assert "comparison_table_markdown" in parsed_bench
            assert "summaries" in parsed_bench
            assert len(parsed_bench["summaries"]) == 2
