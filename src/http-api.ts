#!/usr/bin/env node
/** Fastify HTTP API for SmartRelay MCP delegation server.
 *
 * Provides an authenticated HTTP interface to all MCP tools, allowing external
 * plugins (MCPHub, etc.) to call SmartRelay over HTTP instead of stdio.
 *
 * Transport: HTTP/JSON with Bearer token auth.
 */

import { parseArgs } from 'node:util';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

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
  pluginConfigure,
  pluginGetLogs,
  pluginHealthCheck,
  pluginRemove,
  pluginStatus,
  reviewCode,
  reviewFile,
  switchModel,
  testFile,
} from './tools/index.js';
import { describeError, loadDotEnv } from './util.js';

loadDotEnv();

const logger = getLogger('smartrelay.http');

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
// AUTHENTICATION HOOK
// =========================================================================

export function verifyApiKey(request: FastifyRequest, reply: FastifyReply): void {
  const expectedKey = process.env['SMARTRELAY_HTTP_API_KEY'];
  if (!expectedKey) {
    logger.warning('SMARTRELAY_HTTP_API_KEY not set in environment');
    reply.status(500).send({
      detail: 'Server misconfigured: SMARTRELAY_HTTP_API_KEY not set',
    });
    return;
  }

  const authHeader = request.headers['authorization'];
  if (!authHeader) {
    reply.header('WWW-Authenticate', 'Bearer');
    reply.status(401).send({ detail: 'Missing Authorization header' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
    reply.header('WWW-Authenticate', 'Bearer');
    reply.status(401).send({
      detail: 'Invalid Authorization header format. Use: Bearer <token>',
    });
    return;
  }

  const token = parts[1];
  if (token !== expectedKey) {
    reply.header('WWW-Authenticate', 'Bearer');
    reply.status(401).send({ detail: 'Invalid API key' });
    return;
  }
}

// =========================================================================
// DISPATCH TOOLS
// =========================================================================

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const router = getRouter();
  const registry = getRegistry();
  const engine = getEngine();

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
      if (!code) return { error: 'Missing required argument: code' };
      return reviewCode(router, code, focus);
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
      if (!filePath) return { error: 'Missing required argument: file_path' };
      return reviewFile(router, filePath, focus);
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

// =========================================================================
// CREATE FASTIFY SERVER
// =========================================================================

export function createHttpServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  // Health endpoint
  app.get('/v1/health', async (request, reply) => {
    verifyApiKey(request, reply);
    if (reply.sent) return;

    try {
      const registry = getRegistry();
      return {
        status: 'healthy',
        service: 'smartrelay-http',
        version: '0.2.0',
        runners_loaded: registry.registeredIds().length,
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        service: 'smartrelay-http',
        error: describeError(err),
      };
    }
  });

  // Runners endpoint
  app.get('/v1/runners', async (request, reply) => {
    verifyApiKey(request, reply);
    if (reply.sent) return;

    try {
      const registry = getRegistry();
      return registry.getRunnersMetadata();
    } catch (err) {
      reply.status(500).send({ error: `Failed to list runners: ${describeError(err)}` });
    }
  });

  // Tool dispatch endpoint
  app.post<{ Params: { toolName: string }; Body: Record<string, unknown> }>(
    '/v1/tools/:toolName',
    async (request, reply) => {
      verifyApiKey(request, reply);
      if (reply.sent) return;

      const { toolName } = request.params;
      const body = request.body ?? {};

      try {
        const result = await dispatchTool(toolName, body);
        return result;
      } catch (err) {
        const msg = describeError(err);
        if (msg.includes('Unknown tool')) {
          reply.status(400).send({ error: msg });
        } else {
          reply.status(500).send({ error: `Tool execution error: ${msg}` });
        }
      }
    },
  );

  return app;
}

// =========================================================================
// CLI ENTRYPOINT
// =========================================================================

export async function runHttpServer(options?: {
  config?: string;
  host?: string;
  port?: number;
}): Promise<void> {
  const host = options?.host ?? '127.0.0.1';
  const port = options?.port ?? 8000;
  const config = options?.config ?? null;

  getRegistry(config);
  logger.info(`Configuration loaded. Starting HTTP API server on ${host}:${port}`);

  const app = createHttpServer();
  await app.listen({ host, port });
  logger.info(`SmartRelay HTTP API server listening on http://${host}:${port}`);
}

const isDirectExecution =
  process.argv[1]?.endsWith('http-api.ts') || process.argv[1]?.endsWith('http-api.js');

if (isDirectExecution) {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '8000' },
    },
    allowPositionals: true,
  });

  runHttpServer({
    config: values.config,
    host: values.host,
    port: values.port ? parseInt(values.port, 10) : 8000,
  }).catch((err) => {
    logger.error('Fatal error starting HTTP API server:', err);
    process.exitCode = 1;
  });
}
