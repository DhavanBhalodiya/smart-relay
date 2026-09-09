"""Unit and integration tests for Phase 3 benchmark engine and scorers."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_delegation_server.benchmark.engine import BenchmarkEngine, BenchmarkResult
from mcp_delegation_server.benchmark.scorers import (
    CostScorer,
    ExactMatchScorer,
    LatencyScorer,
    LLMJudgeScorer,
    ScoreResult,
)
from mcp_delegation_server.runners.base import BaseRunner, RunnerConfig, RunnerResult
from mcp_delegation_server.runners.registry import RunnerRegistry
from mcp_delegation_server.server import benchmark_run


@pytest.mark.asyncio
async def test_latency_and_cost_scorers():
    """Test LatencyScorer and CostScorer compute accurate metrics."""
    result = RunnerResult(
        runner_id="test-model",
        model="test-model-v1",
        task="Write code",
        output="print('hello')",
        latency_ms=500.0,
        input_tokens=100,
        output_tokens=50,
        estimated_cost_usd=0.0015,
        success=True,
    )

    latency_scorer = LatencyScorer()
    lat_score = await latency_scorer.score(task="Write code", result=result)
    assert lat_score.score == 500.0
    assert lat_score.unit == "ms"
    assert lat_score.details["tokens_per_second"] == 100.0

    cost_scorer = CostScorer()
    c_score = await cost_scorer.score(task="Write code", result=result)
    assert c_score.score == 0.0015
    assert c_score.unit == "usd"
    assert c_score.details["total_tokens"] == 150


@pytest.mark.asyncio
async def test_exact_match_scorer():
    """Test ExactMatchScorer on exact, case-insensitive, and partial matches."""
    scorer = ExactMatchScorer()

    # Exact match
    res_exact = RunnerResult(
        runner_id="r1",
        model="m1",
        task="What is 2+2?",
        output="4",
        latency_ms=10.0,
        input_tokens=5,
        output_tokens=1,
        estimated_cost_usd=0.0,
        success=True,
    )
    score_exact = await scorer.score("What is 2+2?", res_exact, reference_answer="4")
    assert score_exact.score == 100.0

    # Case-insensitive match
    res_case = RunnerResult(
        runner_id="r2",
        model="m2",
        task="Capital of France?",
        output="paris",
        latency_ms=10.0,
        input_tokens=5,
        output_tokens=1,
        estimated_cost_usd=0.0,
        success=True,
    )
    score_case = await scorer.score("Capital of France?", res_case, reference_answer="Paris")
    assert score_case.score == 95.0

    # Substring match
    res_sub = RunnerResult(
        runner_id="r3",
        model="m3",
        task="Capital of France?",
        output="The capital of France is Paris.",
        latency_ms=10.0,
        input_tokens=5,
        output_tokens=7,
        estimated_cost_usd=0.0,
        success=True,
    )
    score_sub = await scorer.score("Capital of France?", res_sub, reference_answer="Paris")
    assert score_sub.score == 80.0


@pytest.mark.asyncio
async def test_llm_judge_scorer_mock():
    """Test LLMJudgeScorer with mocked judge runner output."""
    mock_judge_runner = MagicMock(spec=BaseRunner)
    mock_judge_runner.id = "judge-claude"
    mock_judge_runner.model = "claude-sonnet-4.5"

    judge_output = json.dumps({
        "score": 92.5,
        "strengths": ["Clean code", "Includes edge case handling"],
        "weaknesses": ["Minor naming nitpick"],
        "critique": "Excellent implementation of binary search.",
    })

    mock_judge_res = RunnerResult(
        runner_id="judge-claude",
        model="claude-sonnet-4.5",
        task="judge",
        output=judge_output,
        latency_ms=200.0,
        input_tokens=50,
        output_tokens=20,
        estimated_cost_usd=0.0001,
        success=True,
    )
    mock_judge_runner.execute = AsyncMock(return_value=mock_judge_res)

    judge_scorer = LLMJudgeScorer(judge_runner=mock_judge_runner)

    candidate_res = RunnerResult(
        runner_id="candidate-1",
        model="gpt-4o",
        task="Write binary search",
        output="def binary_search(...): pass",
        latency_ms=150.0,
        input_tokens=20,
        output_tokens=30,
        estimated_cost_usd=0.0002,
        success=True,
    )

    score = await judge_scorer.score(task="Write binary search", result=candidate_res)
    assert score.score == 92.5
    assert score.details["judge_runner"] == "judge-claude"
    assert "Clean code" in score.details["strengths"]
    assert "Excellent implementation" in score.reasoning


@pytest.mark.asyncio
async def test_benchmark_engine_fanout_and_ranking():
    """Test BenchmarkEngine fans out to multiple mock runners and handles runner errors."""
    registry = MagicMock(spec=RunnerRegistry)

    # Runner 1: Fast and successful
    runner_1 = MagicMock(spec=BaseRunner)
    runner_1.id = "fast-runner"
    runner_1.model = "model-fast"
    res_1 = RunnerResult(
        runner_id="fast-runner",
        model="model-fast",
        task="Hello",
        output="Fast response",
        latency_ms=50.0,
        input_tokens=10,
        output_tokens=5,
        estimated_cost_usd=0.0001,
        success=True,
    )
    runner_1.execute = AsyncMock(return_value=res_1)

    # Runner 2: Slow and successful
    runner_2 = MagicMock(spec=BaseRunner)
    runner_2.id = "slow-runner"
    runner_2.model = "model-slow"
    res_2 = RunnerResult(
        runner_id="slow-runner",
        model="model-slow",
        task="Hello",
        output="Slow response",
        latency_ms=500.0,
        input_tokens=10,
        output_tokens=5,
        estimated_cost_usd=0.0002,
        success=True,
    )
    runner_2.execute = AsyncMock(return_value=res_2)

    # Runner 3: Failing runner
    runner_3 = MagicMock(spec=BaseRunner)
    runner_3.id = "failing-runner"
    runner_3.model = "model-failing"
    res_3 = RunnerResult(
        runner_id="failing-runner",
        model="model-failing",
        task="Hello",
        output="",
        latency_ms=20.0,
        input_tokens=0,
        output_tokens=0,
        estimated_cost_usd=0.0,
        success=False,
        error_message="API connection failed",
    )
    runner_3.execute = AsyncMock(return_value=res_3)

    registry.get = MagicMock(side_effect=lambda rid: {
        "fast-runner": runner_1,
        "slow-runner": runner_2,
        "failing-runner": runner_3,
    }.get(rid))

    engine = BenchmarkEngine(registry=registry, max_concurrency=3)
    bench_result: BenchmarkResult = await engine.run_benchmark(
        task="Hello",
        runner_ids=["fast-runner", "slow-runner", "failing-runner"],
    )

    assert bench_result.runners_evaluated == 3
    assert bench_result.successful_runs == 2
    assert bench_result.failed_runs == 1
    assert bench_result.winner_runner_id == "fast-runner"
    assert len(bench_result.summaries) == 3
    assert "| Rank | Runner ID |" in bench_result.comparison_table_markdown
    assert "fast-runner" in bench_result.comparison_table_markdown


@pytest.mark.asyncio
async def test_benchmark_run_tool():
    """Test benchmark_run tool returns valid formatted JSON benchmark report."""
    res_str = await benchmark_run(
        task="Explain async in 1 sentence",
        runner_ids=["claude-3-7-sonnet", "gpt-4o"],
        reference_answer="Asynchronous programming allows non-blocking execution.",
    )
    parsed = json.loads(res_str)

    assert "task" in parsed
    assert "comparison_table_markdown" in parsed
    assert "summaries" in parsed
    assert len(parsed["summaries"]) == 2
    assert "total_duration_ms" in parsed
