/** Benchmark engine for concurrent multi-runner execution and evaluation. */

import {
  BaseScorer,
  CostScorer,
  ExactMatchScorer,
  LatencyScorer,
  LLMJudgeScorer,
  type ScoreResult,
} from './scorers.js';
import { makeRunnerResult, type BaseRunner, type RunnerResult } from '../runners/base.js';
import type { RunnerRegistry } from '../runners/registry.js';
import { errorMessage, round, Semaphore, startTimer, truncateByCodePoint } from '../util.js';

/** Performance and evaluation scores for a single runner in a benchmark. */
export interface RunnerBenchmarkSummary {
  runner_id: string;
  model: string;
  success: boolean;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  scores: Record<string, Record<string, unknown>>;
  overall_score: number;
  output_preview: string;
  full_output: string;
  error_message: string | null;
}

/** Consolidated benchmark report across all participating runners. */
export interface BenchmarkResult {
  task: string;
  timestamp: string;
  total_duration_ms: number;
  winner_runner_id: string | null;
  runners_evaluated: number;
  successful_runs: number;
  failed_runs: number;
  summaries: RunnerBenchmarkSummary[];
  comparison_table_markdown: string;
}

/** Serialize a benchmark report the way `BenchmarkResult.to_json()` did. */
export function benchmarkResultToJson(result: BenchmarkResult, indent: number | null = 2): string {
  return JSON.stringify(result, null, indent ?? undefined);
}

export interface RunBenchmarkOptions {
  task: string;
  runnerIds: string[];
  params?: Record<string, unknown> | null;
  evalCriteria?: Record<string, unknown> | null;
  referenceAnswer?: string | null;
  judgeRunnerId?: string | null;
}

/** Coordinates concurrent runner execution, applies scorers, and aggregates results. */
export class BenchmarkEngine {
  constructor(
    readonly registry: RunnerRegistry,
    readonly maxConcurrency: number = 5,
  ) {}

  /** Fan a task out across multiple runners concurrently and evaluate their outputs. */
  async runBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkResult> {
    const { task, runnerIds, params, evalCriteria, referenceAnswer, judgeRunnerId } = options;

    const elapsed = startTimer();
    const timestamp = new Date().toISOString();
    const criteria = evalCriteria ?? {};

    // Unknown runner IDs are silently skipped, as in the Python original.
    const runnersToExecute: BaseRunner[] = [];
    for (const runnerId of runnerIds) {
      const runner = this.registry.get(runnerId);
      if (runner) runnersToExecute.push(runner);
    }

    // 1. Execute all runners concurrently, bounded by max_concurrency.
    const semaphore = new Semaphore(this.maxConcurrency);
    const rawResults = await Promise.all(
      runnersToExecute.map((runner) =>
        semaphore.run(async () => {
          try {
            return await runner.execute(task, params);
          } catch (error) {
            return makeRunnerResult({
              runner_id: runner.id,
              model: runner.model,
              task,
              success: false,
              error_message: `Execution failed: ${errorMessage(error)}`,
            });
          }
        }),
      ),
    );

    // 2. Build scorers.
    const scorers: BaseScorer[] = [new LatencyScorer(), new CostScorer()];
    if (referenceAnswer) scorers.push(new ExactMatchScorer());

    if (judgeRunnerId) {
      const judgeRunner = this.registry.get(judgeRunnerId);
      if (judgeRunner) {
        const rubric = typeof criteria['rubric'] === 'string' ? criteria['rubric'] : null;
        scorers.push(new LLMJudgeScorer(judgeRunner, rubric));
      }
    }

    // 3. Score every result.
    const summaries: RunnerBenchmarkSummary[] = [];

    for (const result of rawResults) {
      const scores: Record<string, Record<string, unknown>> = {};
      const qualityScores: number[] = [];

      for (const scorer of scorers) {
        try {
          const scoreResult: ScoreResult = await scorer.score({
            task,
            result,
            referenceAnswer,
            allResults: rawResults,
          });
          scores[scorer.name] = scoreResult as unknown as Record<string, unknown>;

          if (scorer instanceof LLMJudgeScorer) {
            qualityScores.push(scoreResult.score);
          } else if (scorer instanceof ExactMatchScorer && referenceAnswer) {
            qualityScores.push(scoreResult.score);
          }
        } catch (error) {
          scores[scorer.name] = {
            scorer_name: scorer.name,
            score: 0,
            error: errorMessage(error),
          };
        }
      }

      // Overall score: mean of the quality scores, else 100 on success and 0 on failure.
      let overall: number;
      if (qualityScores.length > 0) {
        overall = round(qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length, 1);
      } else {
        overall = result.success ? 100 : 0;
      }

      summaries.push({
        runner_id: result.runner_id,
        model: result.model,
        success: result.success,
        latency_ms: result.latency_ms,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        estimated_cost_usd: result.estimated_cost_usd,
        scores,
        overall_score: overall,
        output_preview: truncateByCodePoint(result.output, 150),
        full_output: result.output,
        error_message: result.error_message,
      });
    }

    // 4. Rank: successes first, then higher score, then lower latency.
    summaries.sort(
      (a, b) =>
        Number(b.success) - Number(a.success) ||
        b.overall_score - a.overall_score ||
        a.latency_ms - b.latency_ms,
    );

    const winner = summaries[0];
    const winnerId = winner && winner.success ? winner.runner_id : null;
    const successfulCount = summaries.filter((summary) => summary.success).length;

    return {
      task,
      timestamp,
      total_duration_ms: elapsed(),
      winner_runner_id: winnerId,
      runners_evaluated: summaries.length,
      successful_runs: successfulCount,
      failed_runs: summaries.length - successfulCount,
      summaries,
      comparison_table_markdown: this.buildMarkdownTable(summaries, winnerId),
    };
  }

  /** Construct a GitHub-flavored Markdown comparison table. */
  private buildMarkdownTable(summaries: RunnerBenchmarkSummary[], winnerId: string | null): string {
    const lines = [
      '| Rank | Runner ID | Model | Status | Latency | Tokens (In/Out) | Est. Cost | Quality Score |',
      '| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |',
    ];

    summaries.forEach((summary, index) => {
      const trophy = summary.runner_id === winnerId ? ' 🏆 (Winner)' : '';
      const status = summary.success ? '✅ Success' : '❌ Failed';
      const tokens = `${summary.input_tokens} / ${summary.output_tokens}`;
      const cost = `$${summary.estimated_cost_usd.toFixed(5)}`;
      const latency = `${summary.latency_ms.toFixed(0)} ms`;
      const score = summary.success ? `${summary.overall_score.toFixed(1)}/100` : 'N/A';

      lines.push(
        `| ${index + 1} | **\`${summary.runner_id}\`**${trophy} | \`${summary.model}\` | ${status} | ` +
          `${latency} | ${tokens} | ${cost} | ${score} |`,
      );
    });

    return lines.join('\n');
  }
}
