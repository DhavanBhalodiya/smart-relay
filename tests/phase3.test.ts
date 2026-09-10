import { describe, expect, it } from 'vitest';

import { BenchmarkEngine } from '../src/benchmark/engine.js';
import { CostScorer, ExactMatchScorer, LatencyScorer, LLMJudgeScorer } from '../src/benchmark/scorers.js';
import { BaseRunner, makeRunnerResult, type RunnerConfig, type RunnerResult } from '../src/runners/base.js';
import { RunnerRegistry } from '../src/runners/registry.js';
import { benchmarkRun } from '../src/tools/index.js';

class MockRunner extends BaseRunner {
  private handler: (task: string) => Promise<RunnerResult>;

  constructor(id: string, model: string, handler: (task: string) => Promise<RunnerResult>) {
    super({
      id,
      model,
      type: 'mock',
      api_key_env: null,
      base_url: null,
      cost_per_million_input_tokens: 1,
      cost_per_million_output_tokens: 2,
      default_params: {},
      timeout_seconds: 10,
    });
    this.handler = handler;
  }

  override async execute(task: string): Promise<RunnerResult> {
    return this.handler(task);
  }
}

describe('Phase 3: Benchmark Engine and Scorers', () => {
  it('computes accurate metrics in LatencyScorer and CostScorer', async () => {
    const result = makeRunnerResult({
      runner_id: 'test-model',
      model: 'test-model-v1',
      task: 'Write code',
      output: "print('hello')",
      latency_ms: 500.0,
      input_tokens: 100,
      output_tokens: 50,
      estimated_cost_usd: 0.0015,
      success: true,
    });

    const latencyScorer = new LatencyScorer();
    const latScore = await latencyScorer.score({ task: 'Write code', result });
    expect(latScore.score).toBe(500.0);
    expect(latScore.unit).toBe('ms');
    expect(latScore.details['tokens_per_second']).toBe(100.0);

    const costScorer = new CostScorer();
    const cScore = await costScorer.score({ task: 'Write code', result });
    expect(cScore.score).toBe(0.0015);
    expect(cScore.unit).toBe('usd');
    expect(cScore.details['total_tokens']).toBe(150);
  });

  it('evaluates ExactMatchScorer on exact, case-insensitive, and partial matches', async () => {
    const scorer = new ExactMatchScorer();

    // Exact match
    const resExact = makeRunnerResult({
      runner_id: 'r1',
      model: 'm1',
      task: 'What is 2+2?',
      output: '4',
      latency_ms: 10.0,
      input_tokens: 5,
      output_tokens: 1,
      success: true,
    });
    const scoreExact = await scorer.score({
      task: 'What is 2+2?',
      result: resExact,
      referenceAnswer: '4',
    });
    expect(scoreExact.score).toBe(100.0);

    // Case-insensitive match
    const resCase = makeRunnerResult({
      runner_id: 'r2',
      model: 'm2',
      task: 'Capital of France?',
      output: 'paris',
      latency_ms: 10.0,
      input_tokens: 5,
      output_tokens: 1,
      success: true,
    });
    const scoreCase = await scorer.score({
      task: 'Capital of France?',
      result: resCase,
      referenceAnswer: 'Paris',
    });
    expect(scoreCase.score).toBe(95.0);

    // Substring match
    const resSub = makeRunnerResult({
      runner_id: 'r3',
      model: 'm3',
      task: 'Capital of France?',
      output: 'The capital of France is Paris.',
      latency_ms: 10.0,
      input_tokens: 5,
      output_tokens: 7,
      success: true,
    });
    const scoreSub = await scorer.score({
      task: 'Capital of France?',
      result: resSub,
      referenceAnswer: 'Paris',
    });
    expect(scoreSub.score).toBe(80.0);
  });

  it('evaluates LLMJudgeScorer with mocked judge output', async () => {
    const judgeOutput = JSON.stringify({
      score: 92.5,
      strengths: ['Clean code', 'Includes edge case handling'],
      weaknesses: ['Minor naming nitpick'],
      critique: 'Excellent implementation of binary search.',
    });

    const mockJudgeRunner = new MockRunner('judge-claude', 'claude-sonnet-4.5', async () =>
      makeRunnerResult({
        runner_id: 'judge-claude',
        model: 'claude-sonnet-4.5',
        task: 'judge',
        output: judgeOutput,
        latency_ms: 200.0,
        input_tokens: 50,
        output_tokens: 20,
        estimated_cost_usd: 0.0001,
        success: true,
      }),
    );

    const judgeScorer = new LLMJudgeScorer(mockJudgeRunner);
    const candidateRes = makeRunnerResult({
      runner_id: 'candidate-1',
      model: 'gpt-4o',
      task: 'Write binary search',
      output: 'function binarySearch() {}',
      latency_ms: 150.0,
      input_tokens: 20,
      output_tokens: 30,
      estimated_cost_usd: 0.0002,
      success: true,
    });

    const score = await judgeScorer.score({ task: 'Write binary search', result: candidateRes });
    expect(score.score).toBe(92.5);
    expect(score.details['judge_runner']).toBe('judge-claude');
    expect(score.details['strengths']).toContain('Clean code');
    expect(score.reasoning).toContain('Excellent implementation');
  });

  it('fans out to multiple mock runners and aggregates results in BenchmarkEngine', async () => {
    const runner1 = new MockRunner('fast-runner', 'model-fast', async () =>
      makeRunnerResult({
        runner_id: 'fast-runner',
        model: 'model-fast',
        task: 'Hello',
        output: 'Fast response',
        latency_ms: 50.0,
        input_tokens: 10,
        output_tokens: 5,
        estimated_cost_usd: 0.0001,
        success: true,
      }),
    );

    const runner2 = new MockRunner('slow-runner', 'model-slow', async () =>
      makeRunnerResult({
        runner_id: 'slow-runner',
        model: 'model-slow',
        task: 'Hello',
        output: 'Slow response',
        latency_ms: 500.0,
        input_tokens: 10,
        output_tokens: 5,
        estimated_cost_usd: 0.0002,
        success: true,
      }),
    );

    const runner3 = new MockRunner('failing-runner', 'model-failing', async () =>
      makeRunnerResult({
        runner_id: 'failing-runner',
        model: 'model-failing',
        task: 'Hello',
        output: '',
        latency_ms: 20.0,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0.0,
        success: false,
        error_message: 'API connection failed',
      }),
    );

    const mockRegistry = {
      get: (rid: string) => {
        if (rid === 'fast-runner') return runner1;
        if (rid === 'slow-runner') return runner2;
        if (rid === 'failing-runner') return runner3;
        return null;
      },
    } as unknown as RunnerRegistry;

    const engine = new BenchmarkEngine(mockRegistry, 3);
    const benchResult = await engine.runBenchmark({
      task: 'Hello',
      runnerIds: ['fast-runner', 'slow-runner', 'failing-runner'],
    });

    expect(benchResult.runners_evaluated).toBe(3);
    expect(benchResult.successful_runs).toBe(2);
    expect(benchResult.failed_runs).toBe(1);
    expect(benchResult.winner_runner_id).toBe('fast-runner');
    expect(benchResult.summaries.length).toBe(3);
    expect(benchResult.comparison_table_markdown).toContain('| Rank | Runner ID |');
    expect(benchResult.comparison_table_markdown).toContain('fast-runner');
  });
});
