"""Pluggable scorers for benchmarking LLM outputs."""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Any

from mcp_delegation_server.runners.base import BaseRunner, RunnerResult


@dataclass
class ScoreResult:
    """Evaluation score and metrics returned by a scorer."""

    scorer_name: str
    score: float  # Normalized score (e.g. 0.0 to 100.0) or raw metric value
    unit: str = "points"  # "points", "ms", "usd", "percent", "tokens/sec"
    details: dict[str, Any] = field(default_factory=dict)
    reasoning: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class BaseScorer(ABC):
    """Abstract base class for benchmark scorers."""

    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    async def score(
        self,
        task: str,
        result: RunnerResult,
        reference_answer: str | None = None,
        all_results: list[RunnerResult] | None = None,
    ) -> ScoreResult:
        """Compute an evaluation score for a runner's result."""
        pass


class LatencyScorer(BaseScorer):
    """Scores runners based on response latency and generation throughput."""

    @property
    def name(self) -> str:
        return "latency"

    async def score(
        self,
        task: str,
        result: RunnerResult,
        reference_answer: str | None = None,
        all_results: list[RunnerResult] | None = None,
    ) -> ScoreResult:
        if not result.success:
            return ScoreResult(
                scorer_name=self.name,
                score=0.0,
                unit="ms",
                details={"latency_ms": result.latency_ms, "tokens_per_second": 0.0},
                reasoning="Execution failed",
            )

        tokens_per_sec = 0.0
        if result.latency_ms > 0 and result.output_tokens > 0:
            tokens_per_sec = round(result.output_tokens / (result.latency_ms / 1000.0), 2)

        return ScoreResult(
            scorer_name=self.name,
            score=result.latency_ms,
            unit="ms",
            details={
                "latency_ms": result.latency_ms,
                "output_tokens": result.output_tokens,
                "tokens_per_second": tokens_per_sec,
            },
            reasoning=f"Completed in {result.latency_ms} ms (~{tokens_per_sec} tokens/sec)",
        )


class CostScorer(BaseScorer):
    """Scores runners based on financial token cost in USD."""

    @property
    def name(self) -> str:
        return "cost"

    async def score(
        self,
        task: str,
        result: RunnerResult,
        reference_answer: str | None = None,
        all_results: list[RunnerResult] | None = None,
    ) -> ScoreResult:
        total_tokens = result.input_tokens + result.output_tokens
        return ScoreResult(
            scorer_name=self.name,
            score=result.estimated_cost_usd,
            unit="usd",
            details={
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "total_tokens": total_tokens,
                "estimated_cost_usd": result.estimated_cost_usd,
            },
            reasoning=f"Cost: ${result.estimated_cost_usd:.6f} across {total_tokens} total tokens",
        )


class ExactMatchScorer(BaseScorer):
    """Scores outputs against a reference answer using exact match and token overlap."""

    @property
    def name(self) -> str:
        return "reference_match"

    async def score(
        self,
        task: str,
        result: RunnerResult,
        reference_answer: str | None = None,
        all_results: list[RunnerResult] | None = None,
    ) -> ScoreResult:
        if not reference_answer:
            return ScoreResult(
                scorer_name=self.name,
                score=0.0,
                unit="percent",
                details={"evaluated": False},
                reasoning="No reference answer provided for matching",
            )

        if not result.success or not result.output:
            return ScoreResult(
                scorer_name=self.name,
                score=0.0,
                unit="percent",
                details={"exact_match": False, "token_overlap": 0.0},
                reasoning="Runner did not produce valid output",
            )

        target = reference_answer.strip()
        actual = result.output.strip()

        # Exact match
        if actual == target:
            return ScoreResult(
                scorer_name=self.name,
                score=100.0,
                unit="percent",
                details={"exact_match": True, "token_overlap": 1.0},
                reasoning="Exact verbatim match with reference answer",
            )

        # Case-insensitive stripped match
        if actual.lower() == target.lower():
            return ScoreResult(
                scorer_name=self.name,
                score=95.0,
                unit="percent",
                details={"exact_match": False, "case_insensitive_match": True},
                reasoning="Case-insensitive match with reference answer",
            )

        # Substring match
        if target.lower() in actual.lower():
            return ScoreResult(
                scorer_name=self.name,
                score=80.0,
                unit="percent",
                details={"substring_match": True},
                reasoning="Reference answer is fully contained in output",
            )

        # Word token overlap (Jaccard / F1 similarity)
        target_words = set(re.findall(r"\w+", target.lower()))
        actual_words = set(re.findall(r"\w+", actual.lower()))

        if not target_words:
            overlap = 0.0
        else:
            intersection = target_words.intersection(actual_words)
            overlap = len(intersection) / len(target_words)

        score_val = round(overlap * 70.0, 1)
        return ScoreResult(
            scorer_name=self.name,
            score=score_val,
            unit="percent",
            details={
                "exact_match": False,
                "token_overlap_ratio": round(overlap, 3),
            },
            reasoning=f"Token overlap ratio: {overlap:.1%} with reference answer",
        )


class LLMJudgeScorer(BaseScorer):
    """Uses a designated LLM runner as a judge to evaluate and score runner outputs based on a rubric."""

    DEFAULT_RUBRIC = (
        "Evaluate the response on a scale from 0 to 100 based on:\n"
        "1. Correctness & Accuracy (40%)\n"
        "2. Completeness & Code Quality (30%)\n"
        "3. Conciseness & Clarity (20%)\n"
        "4. Strict adherence to instructions (10%)\n"
    )

    def __init__(
        self,
        judge_runner: BaseRunner,
        rubric: str | None = None,
    ) -> None:
        self.judge_runner = judge_runner
        self.rubric = rubric or self.DEFAULT_RUBRIC

    @property
    def name(self) -> str:
        return f"llm_judge ({self.judge_runner.id})"

    async def score(
        self,
        task: str,
        result: RunnerResult,
        reference_answer: str | None = None,
        all_results: list[RunnerResult] | None = None,
    ) -> ScoreResult:
        if not result.success:
            return ScoreResult(
                scorer_name=self.name,
                score=0.0,
                unit="points",
                details={"judge_model": self.judge_runner.model},
                reasoning="Output failed execution, 0 points assigned",
            )

        ref_section = (
            f"\n\n[Optional Reference Answer]:\n{reference_answer}"
            if reference_answer
            else ""
        )

        judge_prompt = f"""You are an impartial, expert AI benchmark judge.
Your role is to evaluate an LLM's response to a given user task according to the scoring rubric.

[Evaluation Rubric]:
{self.rubric}

[User Task/Prompt]:
{task}
{ref_section}

[Candidate Response to Evaluate]:
{result.output}

Provide your evaluation strictly in valid JSON format with the following keys:
- "score": A numeric score from 0.0 to 100.0 (float).
- "strengths": A short list of strengths (strings).
- "weaknesses": A short list of weaknesses (strings).
- "critique": A 1-2 sentence overall summary of the evaluation.

Respond ONLY with valid JSON, without any markdown code fence wrappers if possible.
"""

        try:
            judge_res = await self.judge_runner.execute(
                task=judge_prompt,
                params={"temperature": 0.1, "max_tokens": 512},
            )

            if not judge_res.success:
                return ScoreResult(
                    scorer_name=self.name,
                    score=50.0,
                    unit="points",
                    details={"error": judge_res.error_message},
                    reasoning=f"Judge failed to evaluate: {judge_res.error_message}",
                )

            cleaned_output = judge_res.output.strip()
            # Strip markdown code fences if judge wrapped in ```json ... ```
            if cleaned_output.startswith("```"):
                cleaned_output = re.sub(r"^```(?:json)?\s*", "", cleaned_output)
                cleaned_output = re.sub(r"\s*```$", "", cleaned_output)

            parsed = json.loads(cleaned_output)
            score_val = float(parsed.get("score", 50.0))
            # Clamp score between 0.0 and 100.0
            score_val = max(0.0, min(100.0, score_val))

            return ScoreResult(
                scorer_name=self.name,
                score=score_val,
                unit="points",
                details={
                    "judge_runner": self.judge_runner.id,
                    "judge_model": self.judge_runner.model,
                    "strengths": parsed.get("strengths", []),
                    "weaknesses": parsed.get("weaknesses", []),
                    "critique": parsed.get("critique", ""),
                },
                reasoning=parsed.get("critique", f"Judge assigned {score_val}/100"),
            )

        except Exception as e:
            return ScoreResult(
                scorer_name=self.name,
                score=50.0,
                unit="points",
                details={"parse_error": str(e)},
                reasoning=f"Judge output parsing failed: {str(e)}",
            )
