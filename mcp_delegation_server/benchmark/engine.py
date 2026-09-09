"""Benchmark engine for concurrent multi-runner execution and evaluation."""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import time
from typing import Any

from mcp_delegation_server.benchmark.scorers import (
    BaseScorer,
    CostScorer,
    ExactMatchScorer,
    LatencyScorer,
    LLMJudgeScorer,
    ScoreResult,
)
from mcp_delegation_server.runners.base import RunnerResult
from mcp_delegation_server.runners.registry import RunnerRegistry


@dataclass
class RunnerBenchmarkSummary:
    """Summary of performance and evaluation scores for a single runner in a benchmark."""

    runner_id: str
    model: str
    success: bool
    latency_ms: float
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float
    scores: dict[str, dict[str, Any]] = field(default_factory=dict)
    overall_score: float = 0.0
    output_preview: str = ""
    full_output: str = ""
    error_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class BenchmarkResult:
    """Consolidated benchmark evaluation report across all participating runners."""

    task: str
    timestamp: str
    total_duration_ms: float
    winner_runner_id: str | None
    runners_evaluated: int
    successful_runs: int
    failed_runs: int
    summaries: list[RunnerBenchmarkSummary]
    comparison_table_markdown: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "task": self.task,
            "timestamp": self.timestamp,
            "total_duration_ms": self.total_duration_ms,
            "winner_runner_id": self.winner_runner_id,
            "runners_evaluated": self.runners_evaluated,
            "successful_runs": self.successful_runs,
            "failed_runs": self.failed_runs,
            "summaries": [s.to_dict() for s in self.summaries],
            "comparison_table_markdown": self.comparison_table_markdown,
        }

    def to_json(self, indent: int | None = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


class BenchmarkEngine:
    """Coordinates concurrent runner execution, applies scorers, and aggregates comparative benchmarks."""

    def __init__(self, registry: RunnerRegistry, max_concurrency: int = 5) -> None:
        self.registry = registry
        self.max_concurrency = max_concurrency

    async def run_benchmark(
        self,
        task: str,
        runner_ids: list[str],
        params: dict[str, Any] | None = None,
        eval_criteria: dict[str, Any] | None = None,
        reference_answer: str | None = None,
        judge_runner_id: str | None = None,
    ) -> BenchmarkResult:
        """Fan out a task across multiple runners concurrently and evaluate their outputs."""
        start_time = time.perf_counter()
        timestamp = datetime.now(timezone.utc).isoformat()
        criteria = eval_criteria or {}

        # Resolve requested runners
        runners_to_execute = []
        for rid in runner_ids:
            runner = self.registry.get(rid)
            if runner:
                runners_to_execute.append(runner)
            else:
                # Provide a synthetic failed runner result if unknown
                pass

        semaphore = asyncio.Semaphore(self.max_concurrency)

        async def _execute_with_semaphore(runner):
            async with semaphore:
                try:
                    return await runner.execute(task=task, params=params)
                except Exception as e:
                    return RunnerResult(
                        runner_id=runner.id,
                        model=runner.model,
                        task=task,
                        output="",
                        latency_ms=0.0,
                        input_tokens=0,
                        output_tokens=0,
                        estimated_cost_usd=0.0,
                        success=False,
                        error_message=f"Execution failed: {str(e)}",
                    )

        # 1. Execute all runners concurrently
        runner_tasks = [_execute_with_semaphore(r) for r in runners_to_execute]
        raw_results: list[RunnerResult] = await asyncio.gather(*runner_tasks)

        # 2. Build scorers
        scorers: list[BaseScorer] = [
            LatencyScorer(),
            CostScorer(),
        ]
        if reference_answer:
            scorers.append(ExactMatchScorer())

        # Optional LLM-as-judge scorer
        if judge_runner_id:
            judge_runner = self.registry.get(judge_runner_id)
            if judge_runner:
                rubric = criteria.get("rubric")
                scorers.append(LLMJudgeScorer(judge_runner=judge_runner, rubric=rubric))

        # 3. Score all results concurrently
        summaries: list[RunnerBenchmarkSummary] = []

        for res in raw_results:
            scores_dict: dict[str, dict[str, Any]] = {}
            score_values = []

            for scorer in scorers:
                try:
                    s_res: ScoreResult = await scorer.score(
                        task=task,
                        result=res,
                        reference_answer=reference_answer,
                        all_results=raw_results,
                    )
                    scores_dict[scorer.name] = s_res.to_dict()
                    if isinstance(scorer, LLMJudgeScorer):
                        score_values.append(s_res.score)
                    elif isinstance(scorer, ExactMatchScorer) and reference_answer:
                        score_values.append(s_res.score)
                except Exception as err:
                    scores_dict[scorer.name] = {
                        "scorer_name": scorer.name,
                        "score": 0.0,
                        "error": str(err),
                    }

            # Calculate overall score: average of quality scores (or 100 on success if only latency/cost)
            if score_values:
                overall = round(sum(score_values) / len(score_values), 1)
            elif res.success:
                overall = 100.0
            else:
                overall = 0.0

            preview = res.output[:150] + "..." if len(res.output) > 150 else res.output

            summaries.append(
                RunnerBenchmarkSummary(
                    runner_id=res.runner_id,
                    model=res.model,
                    success=res.success,
                    latency_ms=res.latency_ms,
                    input_tokens=res.input_tokens,
                    output_tokens=res.output_tokens,
                    estimated_cost_usd=res.estimated_cost_usd,
                    scores=scores_dict,
                    overall_score=overall,
                    output_preview=preview,
                    full_output=res.output,
                    error_message=res.error_message,
                )
            )

        # 4. Rank runners and select winner
        # Sort by: success (True > False), then overall_score DESC, then latency ASC
        summaries.sort(
            key=lambda s: (s.success, s.overall_score, -s.latency_ms),
            reverse=True,
        )

        winner_id = summaries[0].runner_id if summaries and summaries[0].success else None
        successful_count = sum(1 for s in summaries if s.success)
        failed_count = len(summaries) - successful_count
        total_duration = round((time.perf_counter() - start_time) * 1000, 2)

        # 5. Build Markdown comparison table
        table_md = self._build_markdown_table(summaries, winner_id)

        return BenchmarkResult(
            task=task,
            timestamp=timestamp,
            total_duration_ms=total_duration,
            winner_runner_id=winner_id,
            runners_evaluated=len(summaries),
            successful_runs=successful_count,
            failed_runs=failed_count,
            summaries=summaries,
            comparison_table_markdown=table_md,
        )

    def _build_markdown_table(
        self, summaries: list[RunnerBenchmarkSummary], winner_id: str | None
    ) -> str:
        """Construct a formatted GitHub Flavored Markdown comparison table."""
        lines = [
            "| Rank | Runner ID | Model | Status | Latency | Tokens (In/Out) | Est. Cost | Quality Score |",
            "| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |",
        ]

        for rank, s in enumerate(summaries, 1):
            trophy = " 🏆 (Winner)" if s.runner_id == winner_id else ""
            status = "✅ Success" if s.success else "❌ Failed"
            tokens = f"{s.input_tokens} / {s.output_tokens}"
            cost = f"${s.estimated_cost_usd:.5f}"
            latency = f"{s.latency_ms:.0f} ms"
            score = f"{s.overall_score:.1f}/100" if s.success else "N/A"

            lines.append(
                f"| {rank} | **`{s.runner_id}`**{trophy} | `{s.model}` | {status} | {latency} | {tokens} | {cost} | {score} |"
            )

        return "\n".join(lines)
