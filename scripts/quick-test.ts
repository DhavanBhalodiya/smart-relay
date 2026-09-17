#!/usr/bin/env node
/** Quick manual test script for executing delegation and benchmark tools locally. */

import { parseArgs } from 'node:util';

import { BenchmarkEngine } from '../src/benchmark/engine.js';
import { TaskRouter } from '../src/router.js';
import { RunnerRegistry } from '../src/runners/registry.js';
import { formatRunnerStatusLines } from '../src/credentials.js';
import { benchmarkRun, delegateTask } from '../src/tools/index.js';
import { loadDotEnv } from '../src/util.js';

loadDotEnv();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      runner: { type: 'string', short: 'r', default: 'openrouter-claude-sonnet-4.5' },
      benchmark: { type: 'boolean', short: 'b', default: false },
      runners: { type: 'string', default: 'openrouter-claude-sonnet-4.5,code-review-agent' },
      judge: { type: 'string' },
      ref: { type: 'string' },
      list: { type: 'boolean', short: 'l', default: false },
      config: { type: 'string', short: 'c', default: 'config.yaml' },
    },
    allowPositionals: true,
  });

  const task = positionals[0] || 'Explain why the sky is blue in 2 concise bullet points.';
  const registry = RunnerRegistry.fromYaml(values.config);
  const router = new TaskRouter(registry);
  const rawConcurrency = registry.serverConfig['max_concurrency'];
  const maxConcurrency = typeof rawConcurrency === 'number' ? rawConcurrency : 5;
  const engine = new BenchmarkEngine(registry, maxConcurrency);

  if (values.list) {
    console.log('=== Registered LLM Runners & Agents ===');
    for (const line of formatRunnerStatusLines(registry.getRunnersMetadata())) {
      console.log(line);
    }
    return;
  }

  if (values.benchmark) {
    const targetRunners = (values.runners ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(`\n=== Fanning out benchmark to: ${targetRunners.join(', ')} ===`);
    console.log(`Task: ${task}\n`);

    const resultJson = await benchmarkRun(registry, engine, {
      task,
      runner_ids: targetRunners,
      reference_answer: values.ref,
      judge_runner_id: values.judge,
    });

    const parsed = JSON.parse(resultJson) as {
      winner_runner_id: string;
      comparison_table_markdown: string;
    };
    console.log(parsed.comparison_table_markdown);
    console.log(`\n🏆 Benchmark Winner: ${parsed.winner_runner_id}`);
    return;
  }

  console.log(`\n=== Delegating task to '${values.runner}' ===`);
  console.log(`Prompt: "${task}"\n`);

  const resultJson = await delegateTask(router, task, values.runner);
  const parsed = JSON.parse(resultJson) as {
    success: boolean;
    output: string;
    latency_ms: number;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    error_message: string | null;
  };

  if (parsed.success) {
    console.log('--- Output ---');
    console.log(parsed.output);
    console.log('--------------');
    console.log(`Latency:      ${parsed.latency_ms.toFixed(0)} ms`);
    console.log(`Tokens:       ${parsed.input_tokens} prompt + ${parsed.output_tokens} completion`);
    console.log(`Cost:         $${parsed.estimated_cost_usd.toFixed(6)}`);
  } else {
    console.error(`❌ Execution Failed: ${parsed.error_message}`);
  }
}

main().catch((err) => {
  console.error('Error running quick test:', err);
  process.exitCode = 1;
});
