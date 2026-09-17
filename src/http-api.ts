#!/usr/bin/env node
/** Fastify HTTP API for SmartRelay MCP delegation server.
 *
 * Provides an authenticated HTTP interface to all MCP tools, allowing external
 * plugins (MCPHub, etc.) to call SmartRelay over HTTP instead of stdio.
 *
 * Transport: HTTP/JSON with Bearer token auth.
 */

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { warnIfNoCredentials } from './credentials.js';
import { getLogger } from './logger.js';
import { dispatchTool, getRegistry } from './tools/dispatch.js';
import { describeError, loadDotEnv } from './util.js';

// Re-exported so existing importers of `http-api` keep resolving after the
// dispatch logic moved to `tools/dispatch.ts`.
export { createDispatchContext, dispatchTool, getEngine, getRegistry, getRouter } from './tools/dispatch.js';

loadDotEnv();

const logger = getLogger('smartrelay.http');

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

  warnIfNoCredentials(getRegistry(config).getRunnersMetadata(), logger);
  logger.info(`Configuration loaded. Starting HTTP API server on ${host}:${port}`);

  const app = createHttpServer();
  await app.listen({ host, port });
  logger.info(`SmartRelay HTTP API server listening on http://${host}:${port}`);
}

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
  return ['http-api', 'smartrelay-http'].includes(base);
}

if (checkDirectExecution()) {
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
