/**
 * Transport-agnostic tool dispatch.
 *
 * Extracted from `http-api.ts` so the HTTP API, the MCPHub plugin, and tests all
 * route through one switch instead of three drifting copies. Adding a tool here
 * reaches every surface at once.
 *
 * Deliberately does NOT call `loadDotEnv()` at module scope — only the two CLI
 * entrypoints (`server.ts`, `http-api.ts`) do. If this module loaded `.env`
 * files, an ambient `.env` sitting in whatever directory the host process
 * happens to run from would silently override credentials the user configured
 * explicitly (for example in the MCPHub settings UI).
 */

import { BenchmarkEngine } from '../benchmark/engine.js';
import { getLogger } from '../logger.js';
import { TaskRouter } from '../router.js';
import { RunnerRegistry } from '../runners/registry.js';
import {
  askSubagent,
  auditFileSecurity,
  auditSecurity,
  benchmarkRun,
  createPlan,
  delegateTask,
  explainCode,
  explainFile,
  generateTests,
  getActiveModel,
  listRunners,
  pluginConfigure,
  pluginGetLogs,
  pluginHealthCheck,
  pluginRemove,
  pluginStatus,
  reviewCode,
  reviewFile,
  switchModel,
  testFile,
} from './handlers.js';

const logger = getLogger('smartrelay.dispatch');

/** The three collaborators every tool handler needs. */
export interface DispatchContext {
  registry: RunnerRegistry;
  router: TaskRouter;
  engine: BenchmarkEngine;
}

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

/**
 * Build a standalone context that does not share the module-level singletons.
 *
 * Used where the process hosts more than just SmartRelay (the MCPHub plugin) and
 * by tests that need an isolated registry.
 */
export function createDispatchContext(configPath?: string | null): DispatchContext {
  const registry = RunnerRegistry.fromYaml(configPath ?? null);
  const rawConcurrency = registry.serverConfig['max_concurrency'];
  const maxConcurrency = typeof rawConcurrency === 'number' ? rawConcurrency : 5;
  return {
    registry,
    router: new TaskRouter(registry),
    engine: new BenchmarkEngine(registry, maxConcurrency),
  };
}

// =========================================================================
// DISPATCH TOOLS
// =========================================================================

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown> = {},
  ctx?: DispatchContext,
): Promise<unknown> {
  const router = ctx ? ctx.router : getRouter();
  const registry = ctx ? ctx.registry : getRegistry();
  const engine = ctx ? ctx.engine : getEngine();

  // Normalize tool name (handle both smartrelay_* and plain tool names)
  const norm = toolName.startsWith('smartrelay_') ? toolName : `smartrelay_${toolName}`;

  switch (norm) {
    // Plugin lifecycle
    case 'smartrelay_configure':
      return pluginConfigure(args);
    case 'smartrelay_status':
      return pluginStatus(registry);
    case 'smartrelay_remove':
      return pluginRemove();
    case 'smartrelay_health_check':
      return pluginHealthCheck(registry);
    case 'smartrelay_get_logs':
      return pluginGetLogs(args);

    // Model switching
    case 'smartrelay_switch_model': {
      const model = typeof args['model'] === 'string' ? args['model'] : 'auto';
      return switchModel(router, model);
    }
    case 'smartrelay_get_active_model':
      return getActiveModel(router);

    // Delegation tools
    case 'smartrelay_create_plan': {
      const goal = typeof args['goal'] === 'string' ? args['goal'] : '';
      const context = typeof args['context'] === 'string' ? args['context'] : '';
      if (!goal) return { error: 'Missing required argument: goal' };
      return createPlan(router, goal, context);
    }
    case 'smartrelay_review_code': {
      const code = typeof args['code'] === 'string' ? args['code'] : '';
      const focus =
        typeof args['focus'] === 'string'
          ? args['focus']
          : 'bugs, security, clean code, and performance';
      const language = typeof args['language'] === 'string' ? args['language'] : 'auto';
      if (!code) return { error: 'Missing required argument: code' };
      return reviewCode(router, code, focus, language);
    }
    case 'smartrelay_generate_tests': {
      const code = typeof args['code'] === 'string' ? args['code'] : '';
      const framework =
        typeof args['framework'] === 'string'
          ? args['framework']
          : 'standard unit test framework (pytest, flutter_test, etc.)';
      if (!code) return { error: 'Missing required argument: code' };
      return generateTests(router, code, framework);
    }
    case 'smartrelay_ask_subagent': {
      const prompt = typeof args['prompt'] === 'string' ? args['prompt'] : '';
      const model = typeof args['model'] === 'string' ? args['model'] : 'auto';
      if (!prompt) return { error: 'Missing required argument: prompt' };
      return askSubagent(router, prompt, model);
    }
    case 'smartrelay_review_file': {
      const filePath = typeof args['file_path'] === 'string' ? args['file_path'] : '';
      const focus =
        typeof args['focus'] === 'string'
          ? args['focus']
          : 'bugs, security, clean code, and performance';
      const language = typeof args['language'] === 'string' ? args['language'] : 'auto';
      if (!filePath) return { error: 'Missing required argument: file_path' };
      return reviewFile(router, filePath, focus, language);
    }
    case 'smartrelay_test_file': {
      const filePath = typeof args['file_path'] === 'string' ? args['file_path'] : '';
      const framework =
        typeof args['framework'] === 'string'
          ? args['framework']
          : 'standard unit test framework (pytest, flutter_test, etc.)';
      if (!filePath) return { error: 'Missing required argument: file_path' };
      return testFile(router, filePath, framework);
    }
    case 'smartrelay_explain_code': {
      const code = typeof args['code'] === 'string' ? args['code'] : '';
      const audience = typeof args['audience'] === 'string' ? args['audience'] : 'mid-level engineer';
      const language = typeof args['language'] === 'string' ? args['language'] : 'auto';
      if (!code) return { error: 'Missing required argument: code' };
      return explainCode(router, code, audience, language);
    }
    case 'smartrelay_explain_file': {
      const filePath = typeof args['file_path'] === 'string' ? args['file_path'] : '';
      const audience = typeof args['audience'] === 'string' ? args['audience'] : 'mid-level engineer';
      if (!filePath) return { error: 'Missing required argument: file_path' };
      return explainFile(router, filePath, audience);
    }
    case 'smartrelay_audit_security': {
      const code = typeof args['code'] === 'string' ? args['code'] : '';
      const focus =
        typeof args['focus'] === 'string'
          ? args['focus']
          : 'OWASP Top 10, CWE vulnerabilities, secrets, and auth flaws';
      const language = typeof args['language'] === 'string' ? args['language'] : 'auto';
      if (!code) return { error: 'Missing required argument: code' };
      return auditSecurity(router, code, focus, language);
    }
    case 'smartrelay_audit_file_security': {
      const filePath = typeof args['file_path'] === 'string' ? args['file_path'] : '';
      const focus =
        typeof args['focus'] === 'string'
          ? args['focus']
          : 'OWASP Top 10, CWE vulnerabilities, secrets, and auth flaws';
      const language = typeof args['language'] === 'string' ? args['language'] : 'auto';
      if (!filePath) return { error: 'Missing required argument: file_path' };
      return auditFileSecurity(router, filePath, focus, language);
    }
    case 'smartrelay_list_runners':
      return listRunners(registry);
    case 'smartrelay_delegate_task': {
      const task = typeof args['task'] === 'string' ? args['task'] : '';
      const runnerId = typeof args['runner_id'] === 'string' ? args['runner_id'] : 'auto';
      const params =
        typeof args['params'] === 'object' && args['params'] !== null
          ? (args['params'] as Record<string, unknown>)
          : undefined;
      if (!task) return { error: 'Missing required argument: task' };
      return delegateTask(router, task, runnerId, params);
    }
    case 'smartrelay_benchmark_run': {
      const task = typeof args['task'] === 'string' ? args['task'] : '';
      if (!task) return { error: 'Missing required argument: task' };
      return benchmarkRun(registry, engine, {
        task,
        runner_ids: Array.isArray(args['runner_ids'])
          ? (args['runner_ids'] as string[])
          : undefined,
        params:
          typeof args['params'] === 'object' && args['params'] !== null
            ? (args['params'] as Record<string, unknown>)
            : undefined,
        reference_answer:
          typeof args['reference_answer'] === 'string' ? args['reference_answer'] : undefined,
        judge_runner_id:
          typeof args['judge_runner_id'] === 'string' ? args['judge_runner_id'] : undefined,
        eval_criteria:
          typeof args['eval_criteria'] === 'object' && args['eval_criteria'] !== null
            ? (args['eval_criteria'] as Record<string, unknown>)
            : undefined,
      });
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
