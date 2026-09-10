#!/usr/bin/env node
/** MCP Delegation Server entrypoint and tool registration. */

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { BenchmarkEngine } from './benchmark/engine.js';
import { getLogger } from './logger.js';
import { TaskRouter } from './router.js';
import { RunnerRegistry } from './runners/registry.js';
import {
  askSubagent,
  benchmarkRun,
  createPlan,
  delegateTask,
  explainCode,
  explainFile,
  generateTests,
  getActiveModel,
  listRunners,
  reviewCode,
  reviewFile,
  switchModel,
  testFile,
} from './tools/index.js';
import { loadDotEnv } from './util.js';

// Auto-load .env
loadDotEnv();

const logger = getLogger('mcp_delegation_server');

// Initialize MCP server and singletons
export const server = new McpServer({
  name: 'mcp-delegation-server',
  version: '0.2.0',
});

let registryInstance: RunnerRegistry | null = null;
let engineInstance: BenchmarkEngine | null = null;
let routerInstance: TaskRouter | null = null;

export function getRegistry(configPath?: string | null): RunnerRegistry {
  if (!registryInstance) {
    try {
      registryInstance = RunnerRegistry.fromYaml(configPath);
      logger.info(`Loaded runners: [${registryInstance.registeredIds().join(', ')}]`);
    } catch (err) {
      logger.warning(`Could not initialize registry on startup: ${err}`);
      registryInstance = new RunnerRegistry(configPath ?? null);
    }
  } else {
    registryInstance.reloadIfModified();
  }
  return registryInstance;
}

export function getEngine(): BenchmarkEngine {
  const reg = getRegistry();
  if (!engineInstance || engineInstance.registry !== reg) {
    const rawConcurrency = reg.serverConfig['max_concurrency'];
    const maxConcurrency = typeof rawConcurrency === 'number' ? rawConcurrency : 5;
    engineInstance = new BenchmarkEngine(reg, maxConcurrency);
  }
  return engineInstance;
}

export function getRouter(): TaskRouter {
  const reg = getRegistry();
  if (!routerInstance || routerInstance.registry !== reg) {
    routerInstance = new TaskRouter(reg);
  }
  return routerInstance;
}

// =========================================================================
// REGISTER MCP TOOLS
// =========================================================================

// 1. switch_model
server.registerTool(
  'switch_model',
  {
    description:
      'Switch the active model/sub-agent for subsequent coding, review, and question tasks, or view available models. ' +
      "Shortcuts include: 'openrouter', 'deepseek', 'v3', 'qwen', 'llama', 'gemini', 'nvidia', 'claude', 'ollama', 'auto', or 'direct'. " +
      "Call with no argument or 'list' to view the full model menu.",
    inputSchema: z.object({
      model: z
        .string()
        .optional()
        .describe(
          "Target model or shortcut ('openrouter', 'deepseek', 'v3', 'qwen', 'llama', 'gemini', 'nvidia', 'claude', 'ollama', 'auto', 'direct', or 'list')",
        ),
    }),
  },
  async ({ model }) => {
    const msg = switchModel(getRouter(), model ?? 'list');
    return { content: [{ type: 'text', text: msg }] };
  },
);

// 2. get_active_model
server.registerTool(
  'get_active_model',
  {
    description: 'Get the currently active model and routing mode.',
    inputSchema: z.object({}),
  },
  async () => {
    const info = getActiveModel(getRouter());
    return { content: [{ type: 'text', text: info }] };
  },
);

// 3. create_plan
server.registerTool(
  'create_plan',
  {
    description:
      'Create a structured, phased architectural implementation plan for any feature or project. ' +
      'Automatically routes to the specialized Planner Agent (Claude Sonnet 4.5).',
    inputSchema: z.object({
      goal: z.string().describe('The feature, requirement, bug fix, or refactoring goal to plan.'),
      context: z
        .string()
        .optional()
        .describe('Optional background context, existing codebase details, or constraints.'),
    }),
  },
  async ({ goal, context }) => {
    const result = await createPlan(getRouter(), goal, context ?? '');
    return { content: [{ type: 'text', text: result }] };
  },
);

// 4. review_code
server.registerTool(
  'review_code',
  {
    description:
      'Perform an in-depth, expert code review on any function, file, or code snippet. ' +
      'Checks for edge cases, memory leaks, security vulnerabilities, and provides refactored code.',
    inputSchema: z.object({
      code: z.string().describe('The source code, diff, or function to review.'),
      focus: z
        .string()
        .optional()
        .describe("Optional review focus areas (default: 'bugs, security, clean code, and performance')."),
    }),
  },
  async ({ code, focus }) => {
    const result = await reviewCode(
      getRouter(),
      code,
      focus ?? 'bugs, security, clean code, and performance',
    );
    return { content: [{ type: 'text', text: result }] };
  },
);

// 5. generate_tests
server.registerTool(
  'generate_tests',
  {
    description:
      'Generate production-ready unit and integration tests with edge case coverage. ' +
      'Produces complete, runnable tests with mocking, assertions, and edge case handling.',
    inputSchema: z.object({
      code: z.string().describe('The source code or function that needs test coverage.'),
      framework: z
        .string()
        .optional()
        .describe("Optional testing framework (default: 'standard unit test framework')."),
    }),
  },
  async ({ code, framework }) => {
    const result = await generateTests(
      getRouter(),
      code,
      framework ?? 'standard unit test framework (pytest, flutter_test, etc.)',
    );
    return { content: [{ type: 'text', text: result }] };
  },
);

// 6. ask_subagent
server.registerTool(
  'ask_subagent',
  {
    description:
      'Ask any programming or reasoning question directly to an external sub-agent model.',
    inputSchema: z.object({
      prompt: z.string().describe('Your natural language question, instruction, or coding problem.'),
      model: z
        .string()
        .optional()
        .describe("Target model or provider shortcut ('nvidia', 'claude', 'ollama', 'auto', etc.)."),
    }),
  },
  async ({ prompt, model }) => {
    const result = await askSubagent(getRouter(), prompt, model ?? 'auto');
    return { content: [{ type: 'text', text: result }] };
  },
);

// 7. review_file
server.registerTool(
  'review_file',
  {
    description:
      'Review a source code file directly from disk — TRUE zero Claude token burn. ' +
      'The MCP server reads the file itself and sends it to the Code Review sub-agent.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute or relative path to the source file to review.'),
      focus: z
        .string()
        .optional()
        .describe("Optional review focus areas (default: 'bugs, security, clean code, and performance')."),
    }),
  },
  async ({ file_path, focus }) => {
    const result = await reviewFile(
      getRouter(),
      file_path,
      focus ?? 'bugs, security, clean code, and performance',
    );
    return { content: [{ type: 'text', text: result }] };
  },
);

// 8. test_file
server.registerTool(
  'test_file',
  {
    description:
      'Generate tests for a source code file directly from disk — TRUE zero Claude token burn. ' +
      'The MCP server reads the file itself and sends it to the Test Generator sub-agent.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute or relative path to the source file to test.'),
      framework: z
        .string()
        .optional()
        .describe("Optional testing framework (default: 'standard unit test framework')."),
    }),
  },
  async ({ file_path, framework }) => {
    const result = await testFile(
      getRouter(),
      file_path,
      framework ?? 'standard unit test framework (pytest, flutter_test, etc.)',
    );
    return { content: [{ type: 'text', text: result }] };
  },
);

// 9. explain_code
server.registerTool(
  'explain_code',
  {
    description:
      'Get a clear, structured plain-English explanation of any code snippet or function.',
    inputSchema: z.object({
      code: z.string().describe('The source code, function, class, or snippet to explain.'),
      audience: z
        .string()
        .optional()
        .describe("Explanation depth: 'junior', 'mid-level' (default), 'senior', 'non-technical'."),
      language: z.string().optional().describe("Language hint (e.g. 'dart', 'python') or 'auto'."),
    }),
  },
  async ({ code, audience, language }) => {
    const result = await explainCode(
      getRouter(),
      code,
      audience ?? 'mid-level engineer',
      language ?? 'auto',
    );
    return { content: [{ type: 'text', text: result }] };
  },
);

// 10. explain_file
server.registerTool(
  'explain_file',
  {
    description:
      'Get a plain-English explanation of a source file directly from disk — TRUE zero Claude token burn.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute or relative path to the source file to explain.'),
      audience: z
        .string()
        .optional()
        .describe("Explanation depth: 'junior', 'mid-level' (default), 'senior', 'non-technical'."),
    }),
  },
  async ({ file_path, audience }) => {
    const result = await explainFile(getRouter(), file_path, audience ?? 'mid-level engineer');
    return { content: [{ type: 'text', text: result }] };
  },
);

// 11. list_runners
server.registerTool(
  'list_runners',
  {
    description: 'List all registered external LLM runners and specialized sub-agents.',
    inputSchema: z.object({}),
  },
  async () => {
    const result = listRunners(getRegistry());
    return { content: [{ type: 'text', text: result }] };
  },
);

// 12. delegate_task
server.registerTool(
  'delegate_task',
  {
    description: 'Delegate a task to an external runner (or use auto for intelligent routing).',
    inputSchema: z.object({
      task: z.string().describe('The natural language prompt, instruction, code, or query.'),
      runner_id: z
        .string()
        .optional()
        .describe("Specific runner ID, or 'auto' to pick the best agent."),
      params: z.record(z.string(), z.unknown()).optional().describe('Inference parameter overrides.'),
    }),
  },
  async ({ task, runner_id, params }) => {
    const result = await delegateTask(getRouter(), task, runner_id ?? 'auto', params);
    return { content: [{ type: 'text', text: result }] };
  },
);

// 13. benchmark_run
server.registerTool(
  'benchmark_run',
  {
    description:
      'Fan out a task across multiple runners concurrently and produce a comparative benchmark report.',
    inputSchema: z.object({
      task: z.string().describe('The natural language prompt or problem to execute.'),
      runner_ids: z
        .array(z.string())
        .optional()
        .describe('Optional list of runners. If omitted, all authenticated runners are evaluated.'),
      params: z.record(z.string(), z.unknown()).optional().describe('Optional inference parameters.'),
      reference_answer: z.string().optional().describe('Optional ground-truth reference answer.'),
      judge_runner_id: z.string().optional().describe('Optional runner ID of LLM judge.'),
      eval_criteria: z.record(z.string(), z.unknown()).optional().describe('Optional rubric criteria.'),
    }),
  },
  async ({ task, runner_ids, params, reference_answer, judge_runner_id, eval_criteria }) => {
    const result = await benchmarkRun(getRegistry(), getEngine(), {
      task,
      runner_ids,
      params,
      reference_answer,
      judge_runner_id,
      eval_criteria,
    });
    return { content: [{ type: 'text', text: result }] };
  },
);

// =========================================================================
// SERVER STARTUP
// =========================================================================

export async function runServer(options?: {
  config?: string;
  transport?: string;
  host?: string;
  port?: number;
}): Promise<void> {
  const configPath = options?.config ?? null;
  getRegistry(configPath);

  const transportType = options?.transport ?? 'stdio';
  logger.info(`Starting MCP server with transport: ${transportType}`);

  if (transportType === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server connected via stdio');
  } else {
    logger.error(`Unsupported transport: ${transportType}. Stdio is currently the standard transport.`);
  }
}

// Direct execution entrypoint
function checkDirectExecution(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    const realScript = realpathSync(script);
    const thisFile = realpathSync(fileURLToPath(import.meta.url));
    if (realScript === thisFile) return true;
  } catch {
    // Fall back to filename checks
  }
  const base = path.basename(script, path.extname(script));
  return ['server', 'smartrelay', 'mcp-delegation-server'].includes(base);
}

if (checkDirectExecution()) {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      transport: { type: 'string', short: 't', default: 'stdio' },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '8000' },
    },
    allowPositionals: true,
  });

  runServer({
    config: values.config,
    transport: values.transport,
    host: values.host,
    port: values.port ? parseInt(values.port, 10) : 8000,
  }).catch((err) => {
    logger.error('Fatal error starting MCP server:', err);
    process.exitCode = 1;
  });
}
