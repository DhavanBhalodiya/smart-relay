/** Pluggable scorers for benchmarking LLM outputs. */

import type { BaseRunner, RunnerResult } from '../runners/base.js';
import { errorMessage, round } from '../util.js';

/**
 * Evaluation score and metrics returned by a scorer.
 *
 * snake_case and in declaration order: this is serialized straight onto the wire.
 */
export interface ScoreResult {
  scorer_name: string;
  /** Normalized score (typically 0-100) or a raw metric value. */
  score: number;
  /** "points", "ms", "usd", "percent", "tokens/sec". */
  unit: string;
  details: Record<string, unknown>;
  reasoning: string | null;
}

function makeScore(init: {
  scorer_name: string;
  score: number;
  unit?: string;
  details?: Record<string, unknown>;
  reasoning?: string | null;
}): ScoreResult {
  return {
    scorer_name: init.scorer_name,
    score: init.score,
    unit: init.unit ?? 'points',
    details: init.details ?? {},
    reasoning: init.reasoning ?? null,
  };
}

/** Context passed to every scorer. */
export interface ScoreContext {
  task: string;
  result: RunnerResult;
  referenceAnswer?: string | null;
  allResults?: RunnerResult[] | null;
}

/** Abstract base class for benchmark scorers. */
export abstract class BaseScorer {
  abstract get name(): string;

  /** Compute an evaluation score for a runner's result. */
  abstract score(context: ScoreContext): Promise<ScoreResult>;
}

/** Scores runners on response latency and generation throughput. */
export class LatencyScorer extends BaseScorer {
  override get name(): string {
    return 'latency';
  }

  override async score({ result }: ScoreContext): Promise<ScoreResult> {
    if (!result.success) {
      return makeScore({
        scorer_name: this.name,
        score: 0,
        unit: 'ms',
        details: { latency_ms: result.latency_ms, tokens_per_second: 0 },
        reasoning: 'Execution failed',
      });
    }

    let tokensPerSec = 0;
    if (result.latency_ms > 0 && result.output_tokens > 0) {
      tokensPerSec = round(result.output_tokens / (result.latency_ms / 1000), 2);
    }

    return makeScore({
      scorer_name: this.name,
      score: result.latency_ms,
      unit: 'ms',
      details: {
        latency_ms: result.latency_ms,
        output_tokens: result.output_tokens,
        tokens_per_second: tokensPerSec,
      },
      reasoning: `Completed in ${result.latency_ms} ms (~${tokensPerSec} tokens/sec)`,
    });
  }
}

/** Scores runners on financial token cost in USD. */
export class CostScorer extends BaseScorer {
  override get name(): string {
    return 'cost';
  }

  override async score({ result }: ScoreContext): Promise<ScoreResult> {
    const totalTokens = result.input_tokens + result.output_tokens;

    return makeScore({
      scorer_name: this.name,
      score: result.estimated_cost_usd,
      unit: 'usd',
      details: {
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        total_tokens: totalTokens,
        estimated_cost_usd: result.estimated_cost_usd,
      },
      reasoning: `Cost: $${result.estimated_cost_usd.toFixed(6)} across ${totalTokens} total tokens`,
    });
  }
}

/**
 * Scores output against a reference answer via exact match and token overlap.
 *
 * The word split uses `\p{L}\p{N}_` rather than JS's ASCII-only `\w` so the
 * overlap ratio matches Python's Unicode-aware `re.findall(r"\w+", ...)`.
 */
export class ExactMatchScorer extends BaseScorer {
  private static readonly WORD_PATTERN = /[\p{L}\p{N}_]+/gu;

  override get name(): string {
    return 'reference_match';
  }

  override async score({ result, referenceAnswer }: ScoreContext): Promise<ScoreResult> {
    if (!referenceAnswer) {
      return makeScore({
        scorer_name: this.name,
        score: 0,
        unit: 'percent',
        details: { evaluated: false },
        reasoning: 'No reference answer provided for matching',
      });
    }

    if (!result.success || !result.output) {
      return makeScore({
        scorer_name: this.name,
        score: 0,
        unit: 'percent',
        details: { exact_match: false, token_overlap: 0 },
        reasoning: 'Runner did not produce valid output',
      });
    }

    const target = referenceAnswer.trim();
    const actual = result.output.trim();

    if (actual === target) {
      return makeScore({
        scorer_name: this.name,
        score: 100,
        unit: 'percent',
        details: { exact_match: true, token_overlap: 1 },
        reasoning: 'Exact verbatim match with reference answer',
      });
    }

    if (actual.toLowerCase() === target.toLowerCase()) {
      return makeScore({
        scorer_name: this.name,
        score: 95,
        unit: 'percent',
        details: { exact_match: false, case_insensitive_match: true },
        reasoning: 'Case-insensitive match with reference answer',
      });
    }

    if (actual.toLowerCase().includes(target.toLowerCase())) {
      return makeScore({
        scorer_name: this.name,
        score: 80,
        unit: 'percent',
        details: { substring_match: true },
        reasoning: 'Reference answer is fully contained in output',
      });
    }

    const targetWords = new Set(target.toLowerCase().match(ExactMatchScorer.WORD_PATTERN) ?? []);
    const actualWords = new Set(actual.toLowerCase().match(ExactMatchScorer.WORD_PATTERN) ?? []);

    let overlap = 0;
    if (targetWords.size > 0) {
      let intersection = 0;
      for (const word of targetWords) if (actualWords.has(word)) intersection++;
      overlap = intersection / targetWords.size;
    }

    return makeScore({
      scorer_name: this.name,
      score: round(overlap * 70, 1),
      unit: 'percent',
      details: { exact_match: false, token_overlap_ratio: round(overlap, 3) },
      reasoning: `Token overlap ratio: ${(overlap * 100).toFixed(1)}% with reference answer`,
    });
  }
}

/** Uses a designated LLM runner as a judge to score outputs against a rubric. */
export class LLMJudgeScorer extends BaseScorer {
  static readonly DEFAULT_RUBRIC =
    'Evaluate the response on a scale from 0 to 100 based on:\n' +
    '1. Correctness & Accuracy (40%)\n' +
    '2. Completeness & Code Quality (30%)\n' +
    '3. Conciseness & Clarity (20%)\n' +
    '4. Strict adherence to instructions (10%)\n';

  readonly rubric: string;

  constructor(
    readonly judgeRunner: BaseRunner,
    rubric?: string | null,
  ) {
    super();
    this.rubric = rubric || LLMJudgeScorer.DEFAULT_RUBRIC;
  }

  override get name(): string {
    return `llm_judge (${this.judgeRunner.id})`;
  }

  override async score({ task, result, referenceAnswer }: ScoreContext): Promise<ScoreResult> {
    if (!result.success) {
      return makeScore({
        scorer_name: this.name,
        score: 0,
        unit: 'points',
        details: { judge_model: this.judgeRunner.model },
        reasoning: 'Output failed execution, 0 points assigned',
      });
    }

    const refSection = referenceAnswer ? `\n\n[Optional Reference Answer]:\n${referenceAnswer}` : '';

    const judgePrompt = `You are an impartial, expert AI benchmark judge.
Your role is to evaluate an LLM's response to a given user task according to the scoring rubric.

[Evaluation Rubric]:
${this.rubric}

[User Task/Prompt]:
${task}
${refSection}

[Candidate Response to Evaluate]:
${result.output}

Provide your evaluation strictly in valid JSON format with the following keys:
- "score": A numeric score from 0.0 to 100.0 (float).
- "strengths": A short list of strengths (strings).
- "weaknesses": A short list of weaknesses (strings).
- "critique": A 1-2 sentence overall summary of the evaluation.

Respond ONLY with valid JSON, without any markdown code fence wrappers if possible.
`;

    try {
      const judgeResult = await this.judgeRunner.execute(judgePrompt, { temperature: 0.1, max_tokens: 512 });

      if (!judgeResult.success) {
        return makeScore({
          scorer_name: this.name,
          score: 50,
          unit: 'points',
          details: { error: judgeResult.error_message },
          reasoning: `Judge failed to evaluate: ${judgeResult.error_message}`,
        });
      }

      let cleaned = judgeResult.output.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleaned) as Record<string, unknown>;

      const rawScore = 'score' in parsed ? Number(parsed['score']) : 50;
      if (!Number.isFinite(rawScore)) throw new Error(`could not convert score to float: ${String(parsed['score'])}`);
      const scoreValue = Math.max(0, Math.min(100, rawScore));

      const critique = 'critique' in parsed ? String(parsed['critique']) : `Judge assigned ${scoreValue}/100`;

      return makeScore({
        scorer_name: this.name,
        score: scoreValue,
        unit: 'points',
        details: {
          judge_runner: this.judgeRunner.id,
          judge_model: this.judgeRunner.model,
          strengths: parsed['strengths'] ?? [],
          weaknesses: parsed['weaknesses'] ?? [],
          critique: 'critique' in parsed ? parsed['critique'] : '',
        },
        reasoning: critique,
      });
    } catch (error) {
      return makeScore({
        scorer_name: this.name,
        score: 50,
        unit: 'points',
        details: { parse_error: errorMessage(error) },
        reasoning: `Judge output parsing failed: ${errorMessage(error)}`,
      });
    }
  }
}
