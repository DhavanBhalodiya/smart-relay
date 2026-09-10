/** Shared handlers and implementations for all SmartRelay tools. */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { BenchmarkEngine, RunBenchmarkOptions } from '../benchmark/engine.js';
import { benchmarkResultToJson } from '../benchmark/engine.js';
import { getLogger } from '../logger.js';
import type { TaskRouter } from '../router.js';
import { makeRunnerResult, runnerResultToJson } from '../runners/base.js';
import type { RunnerRegistry } from '../runners/registry.js';
import { describeError, resolveUserPath } from '../util.js';

const logger = getLogger('smartrelay.tools');

/** Extract strictly the review report and remove any model reasoning or scratchpad text. */
export function cleanReviewOutput(output: string): string {
  const markers = [
    '# 🛡️ Code Review Report',
    '# 🛡️',
    '## 📊 Summary of Findings',
    '## 🚨 Blockers',
    '## 🔴 High Priority Issues',
    '## 🔴 High Priority',
    '## 🟡 Medium Priority Issues',
    '## 🟡 Medium Priority',
    '## 💡 Suggestions & Minor Optimizations',
    '## 💡 Suggestions & Improvements',
    '## 💡 Suggestions',
    '✅ No issues found',
    '⚠️ This reviewer is scoped to Dart/Flutter',
  ];
  for (const marker of markers) {
    const idx = output.indexOf(marker);
    if (idx !== -1) {
      return output.slice(idx).trim();
    }
  }
  return output.trim();
}

/** Read a file from disk, returning `{ content, error }`. */
export function readFileFromDisk(filePath: string): { content: string | null; error: string | null } {
  try {
    const target = resolveUserPath(filePath);
    if (!existsSync(target)) {
      return { content: null, error: `❌ File not found: \`${filePath}\` (resolved to \`${target}\`)` };
    }
    const stat = statSync(target);
    if (!stat.isFile()) {
      return { content: null, error: `❌ Path is not a file: \`${filePath}\`` };
    }
    const sizeKb = stat.size / 1024;
    if (sizeKb > 500) {
      return {
        content: null,
        error:
          `⚠️ File too large: \`${filePath}\` (${sizeKb.toFixed(1)} KB). ` +
          'Max recommended: 500 KB (~125K tokens). Split into smaller files.',
      };
    }
    const content = readFileSync(target, 'utf-8');
    return { content, error: null };
  } catch (err) {
    return { content: null, error: `❌ Error reading file: \`${filePath}\`: ${describeError(err)}` };
  }
}

/** Switch the active model/sub-agent for subsequent tasks. */
export function switchModel(router: TaskRouter, model: string = 'list'): string {
  const { message } = router.setActiveRunner(model);
  return message;
}

/** Get the currently active model and routing mode. */
export function getActiveModel(router: TaskRouter): string {
  const info = router.getActiveRunnerInfo();
  return JSON.stringify(info, null, 2);
}

/** Create a structured architectural implementation plan. */
export async function createPlan(
  router: TaskRouter,
  goal: string,
  context: string = '',
): Promise<string> {
  const runner = router.routeTask(`Create an implementation plan for: ${goal}`);
  if (!runner) {
    return JSON.stringify({ error: 'No planner runner available. Check config.yaml' });
  }

  let taskPrompt = `Create a comprehensive, phased implementation plan for the following goal:\n\n**Goal**: ${goal}`;
  if (context) {
    taskPrompt += `\n\n**Context & Constraints**:\n${context}`;
  }

  const result = await runner.execute(taskPrompt);
  if (result.success) {
    return result.output;
  }
  return `Plan creation failed: ${result.error_message}`;
}

/** Perform an in-depth, expert code review. */
export async function reviewCode(
  router: TaskRouter,
  code: string,
  focus: string = 'bugs, security, clean code, and performance',
): Promise<string> {
  const runner = router.routeTask(`Review code with focus on ${focus}`);
  if (!runner) {
    return JSON.stringify({ error: 'No code review runner available. Check config.yaml' });
  }

  const taskPrompt =
    `Perform a comprehensive code review focusing on: ${focus}.\n\n` +
    'Format the output strictly using the `# 🛡️ Code Review Report` template with Health Score, ' +
    'Summary Table, 🚨 Blockers, ⚠️ Warnings, 💡 Suggestions, ✅ Commendations, and 🛠️ Verification Commands.\n\n' +
    'STRICT RULES:\n' +
    '- Begin directly with `# 🛡️ Code Review Report`.\n' +
    '- NEVER output or rewrite the entire source code file.\n' +
    '- NEVER include internal thinking process, conversational greetings, or closing text.\n\n' +
    `\`\`\`\n${code}\n\`\`\``;

  const result = await runner.execute(taskPrompt);
  if (result.success) {
    return cleanReviewOutput(result.output);
  }
  return `Code review failed: ${result.error_message}`;
}

/** Generate production-ready unit and integration tests. */
export async function generateTests(
  router: TaskRouter,
  code: string,
  framework: string = 'standard unit test framework (pytest, flutter_test, etc.)',
): Promise<string> {
  const runner = router.routeTask('Generate unit tests for this code');
  if (!runner) {
    return JSON.stringify({ error: 'No test generator runner available. Check config.yaml' });
  }

  const taskPrompt = `Generate comprehensive unit and integration tests using ${framework} for this code:\n\n\`\`\`\n${code}\n\`\`\``;
  const result = await runner.execute(taskPrompt);
  if (result.success) {
    return result.output;
  }
  return `Test generation failed: ${result.error_message}`;
}

/** Ask any question directly to an external sub-agent model. */
export async function askSubagent(
  router: TaskRouter,
  prompt: string,
  model: string = 'auto',
): Promise<string> {
  const runner =
    model.toLowerCase() === 'auto' ? router.getDefaultRunner() : router.resolveShortcut(model);

  if (!runner) {
    const allRunners = router.registry.listRunners();
    return JSON.stringify({
      error: `Model '${model}' not found in registry.`,
      available_runners: Array.from(allRunners.keys()),
    });
  }

  logger.info(`ask_subagent: Routing prompt to '${runner.id}' (${runner.model})`);
  const result = await runner.execute(prompt);
  if (result.success) {
    const costStr =
      result.estimated_cost_usd > 0 ? ` | Cost: $${result.estimated_cost_usd.toFixed(6)}` : '';
    const header = `**[Sub-Agent: ${runner.id} (${runner.model}) | Latency: ${Math.round(result.latency_ms)}ms${costStr}]**\n\n`;
    return `${header}${result.output}`;
  }
  return `Execution error (${runner.id}): ${result.error_message}`;
}

/** Review a source code file directly from disk — zero Claude token burn. */
export async function reviewFile(
  router: TaskRouter,
  filePath: string,
  focus: string = 'bugs, security, clean code, and performance',
): Promise<string> {
  const { content: code, error } = readFileFromDisk(filePath);
  if (error || code === null) {
    return error ?? '❌ Could not read file.';
  }

  const resolvedName = path.basename(filePath);
  logger.info(`review_file: Read ${code.length} chars from ${resolvedName}`);

  const runner = router.routeTask(`Review code with focus on ${focus}`);
  if (!runner) {
    return JSON.stringify({ error: 'No code review runner available. Check config.yaml' });
  }

  const taskPrompt =
    `Perform a comprehensive code review of **\`${resolvedName}\`** focusing on: ${focus}.\n\n` +
    'Format the output strictly using the `# 🛡️ Code Review Report` template with Health Score, ' +
    'Summary Table, 🚨 Blockers, ⚠️ Warnings, 💡 Suggestions, ✅ Commendations, and 🛠️ Verification Commands.\n\n' +
    'STRICT RULES:\n' +
    '- Begin directly with `# 🛡️ Code Review Report`.\n' +
    '- NEVER output or rewrite the entire source code file.\n' +
    '- NEVER include internal thinking process, conversational greetings, or closing text.\n\n' +
    `\`\`\`\n${code}\n\`\`\``;

  const result = await runner.execute(taskPrompt);
  if (result.success) {
    return cleanReviewOutput(result.output);
  }
  return `Code review failed: ${result.error_message}`;
}

/** Generate tests for a source code file directly from disk. */
export async function testFile(
  router: TaskRouter,
  filePath: string,
  framework: string = 'standard unit test framework (pytest, flutter_test, etc.)',
): Promise<string> {
  const { content: code, error } = readFileFromDisk(filePath);
  if (error || code === null) {
    return error ?? '❌ Could not read file.';
  }

  const resolvedName = path.basename(filePath);
  logger.info(`test_file: Read ${code.length} chars from ${resolvedName}`);

  const runner = router.routeTask('Generate unit tests for this code');
  if (!runner) {
    return JSON.stringify({ error: 'No test generator runner available. Check config.yaml' });
  }

  const taskPrompt =
    `Generate comprehensive unit and integration tests using ${framework} ` +
    `for the file **\`${resolvedName}\`**:\n\n\`\`\`\n${code}\n\`\`\``;

  const result = await runner.execute(taskPrompt);
  if (result.success) {
    return result.output;
  }
  return `Test generation failed: ${result.error_message}`;
}

/** Get a plain-English explanation of code. */
export async function explainCode(
  router: TaskRouter,
  code: string,
  audience: string = 'mid-level engineer',
  language: string = 'auto',
): Promise<string> {
  const runner = router.routeTask('explain what does this code do');
  if (!runner) {
    return JSON.stringify({ error: 'No explainer runner available. Check config.yaml' });
  }

  const langHint = language.toLowerCase() !== 'auto' ? ` (Language: ${language})` : '';
  const taskPrompt =
    `Explain the following code${langHint} for a ${audience}.\n\n` +
    'Format your response strictly using the `# 📖 Code Explanation:` template.\n\n' +
    `\`\`\`\n${code}\n\`\`\``;

  const result = await runner.execute(taskPrompt);
  if (result.success) {
    return result.output;
  }
  return `Code explanation failed: ${result.error_message}`;
}

/** Get a plain-English explanation of a source file directly from disk. */
export async function explainFile(
  router: TaskRouter,
  filePath: string,
  audience: string = 'mid-level engineer',
): Promise<string> {
  const { content: code, error } = readFileFromDisk(filePath);
  if (error || code === null) {
    return error ?? '❌ Could not read file.';
  }

  const resolvedName = path.basename(filePath);
  logger.info(`explain_file: Read ${code.length} chars from ${resolvedName}`);

  const runner = router.routeTask('explain what does this code do');
  if (!runner) {
    return JSON.stringify({ error: 'No explainer runner available. Check config.yaml' });
  }

  const taskPrompt =
    `Explain the file **\`${resolvedName}\`** for a ${audience}.\n\n` +
    'Format your response strictly using the `# 📖 Code Explanation:` template.\n\n' +
    `\`\`\`\n${code}\n\`\`\``;

  const result = await runner.execute(taskPrompt);
  if (result.success) {
    return result.output;
  }
  return `Code explanation failed: ${result.error_message}`;
}

/** List all registered runners and metadata. */
export function listRunners(registry: RunnerRegistry): string {
  const metadata = registry.getRunnersMetadata();
  return JSON.stringify(metadata, null, 2);
}

/** Delegate a task to an external runner or auto-route. */
export async function delegateTask(
  router: TaskRouter,
  task: string,
  runnerId: string = 'auto',
  params?: Record<string, unknown> | null,
): Promise<string> {
  const runner = router.routeTask(task, runnerId);
  if (!runner) {
    const available = router.registry.registeredIds();
    const errRes = makeRunnerResult({
      runner_id: runnerId,
      model: 'unknown',
      task,
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      success: false,
      error_message:
        `Runner '${runnerId}' is not registered. Available runners: [${available.map((id) => `'${id}'`).join(', ')}]. ` +
        'Use list_runners() to see all registered runners.',
    });
    return runnerResultToJson(errRes);
  }

  try {
    const result = await runner.execute(task, params);
    return runnerResultToJson(result);
  } catch (err) {
    logger.error(`Unhandled error executing runner ${runner.id}:`, err);
    const errRes = makeRunnerResult({
      runner_id: runner.id,
      model: runner.model,
      task,
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      success: false,
      error_message: `Server execution error: ${describeError(err)}`,
    });
    return runnerResultToJson(errRes);
  }
}

/** Fan out a task across multiple runners concurrently and produce a benchmark report. */
export async function benchmarkRun(
  registry: RunnerRegistry,
  engine: BenchmarkEngine,
  options: {
    task: string;
    runner_ids?: string[] | null;
    params?: Record<string, unknown> | null;
    reference_answer?: string | null;
    judge_runner_id?: string | null;
    eval_criteria?: Record<string, unknown> | null;
  },
): Promise<string> {
  let targetRunnerIds = options.runner_ids;
  if (!targetRunnerIds || targetRunnerIds.length === 0) {
    const metadata = registry.getRunnersMetadata();
    targetRunnerIds = metadata.filter((r) => r.is_authenticated).map((r) => r.runner_id);
    if (targetRunnerIds.length === 0) {
      targetRunnerIds = registry.registeredIds();
    }
  }

  const runOptions: RunBenchmarkOptions = {
    task: options.task,
    runnerIds: targetRunnerIds,
    params: options.params,
    evalCriteria: options.eval_criteria,
    referenceAnswer: options.reference_answer,
    judgeRunnerId: options.judge_runner_id,
  };

  const benchmarkResult = await engine.runBenchmark(runOptions);
  return benchmarkResultToJson(benchmarkResult);
}

// =========================================================================
// PLUGIN LIFECYCLE HANDLERS (MCPHub / HTTP plugin)
// =========================================================================

export function pluginConfigure(_args?: Record<string, unknown>): Record<string, unknown> {
  return { status: 'configured' };
}

export function pluginStatus(registry: RunnerRegistry): Record<string, unknown> {
  try {
    return {
      configured: true,
      runners_available: registry.registeredIds().length,
      status: 'healthy',
    };
  } catch (err) {
    return {
      configured: false,
      error: describeError(err),
      status: 'unhealthy',
    };
  }
}

export function pluginRemove(): Record<string, unknown> {
  return { status: 'removed' };
}

export function pluginHealthCheck(registry: RunnerRegistry): Record<string, unknown> {
  try {
    return {
      status: 'healthy',
      details: {
        service: 'smartrelay-http',
        runners_loaded: registry.registeredIds().length,
      },
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      error: describeError(err),
    };
  }
}

export function pluginGetLogs(args?: Record<string, unknown>): Record<string, unknown> {
  return { logs: [], limit: args?.['limit'] ?? 50 };
}
